import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isSyntheticAuditCall } from "@/lib/workMetrics/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  log_id: z.string().uuid(),
  user_id: z.string().uuid(),
  lead_id: z.string().uuid().nullable(),
  client_username: z.string().trim().min(1).max(250).nullable().optional(),
  client_name: z.string().trim().min(1).max(500).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }),
  outcome: z.string().trim().min(1).max(2000),
  notes: z.string().max(5000).nullable().optional(),
  next_followup_date: z.string().nullable().optional(),
}).superRefine((call, context) => {
  if (call.next_followup_date && Number.isNaN(Date.parse(call.next_followup_date))) context.addIssue({ code: "custom", path: ["next_followup_date"], message: "Invalid follow-up date" });
  if (isSyntheticAuditCall(call)) context.addIssue({ code: "custom", path: ["outcome"], message: "Synthetic audit rows are not accepted by the business-call confirmation route" });
});

function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
}
function tokenOf(request: Request) { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }

export async function POST(request: Request) {
  const service = adminClient(); const token = tokenOf(request);
  if (!service || !token) return json(401, { ok: false, code: "AUTH_REQUIRED", message: "Sign in again before retrying this call." });
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return json(401, { ok: false, code: "AUTH_REQUIRED", message: "Sign in again before retrying this call." });
  const { data: account, error: accountError } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (accountError || !account || !active(account.is_active)) return json(403, { ok: false, code: "ACCOUNT_INACTIVE", message: "An active employee account is required." });
  let input: unknown;
  try { input = await request.json(); } catch { return json(400, { ok: false, code: "CALL_VALIDATION_FAILED", message: "Call details could not be read." }); }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return json(400, { ok: false, code: "CALL_VALIDATION_FAILED", message: "Review the call details and retry." });
  const call = parsed.data;
  if (!call.lead_id && (!call.client_username?.trim() || !call.client_name?.trim())) {
    return json(422, { ok: false, code: "CALL_REFERENCE_INVALID", message: "The retained call needs a complete client reference before confirmation." });
  }
  if (call.user_id !== auth.user.id) return json(403, { ok: false, code: "CALL_OWNERSHIP_MISMATCH", message: "This call belongs to another account." });
  const preflight = await service.from("call_logs").select("log_id,user_id").eq("log_id", call.log_id).maybeSingle();
  if (preflight.error) return json(500, { ok: false, code: "CALL_CONFIRMATION_FAILED", message: "The exact call could not be checked safely." });
  if (preflight.data?.user_id && preflight.data.user_id !== auth.user.id) return json(409, { ok: false, code: "CALL_ID_OWNERSHIP_COLLISION", message: "This call ID belongs to another account." });
  if (preflight.data) return json(200, { ok: true, code: "CALL_ALREADY_CONFIRMED", log_id: call.log_id });
  const payload = {
    log_id: call.log_id, user_id: call.user_id, lead_id: call.lead_id,
    client_username: call.client_username ?? null, client_name: call.client_name ?? null,
    timestamp: call.timestamp, outcome: call.outcome, notes: call.notes ?? null,
    next_followup_date: call.next_followup_date ?? null,
  };
  const insert = await service.from("call_logs").insert(payload);
  if (insert.error && insert.error.code !== "23505") {
    const referenceInvalid = insert.error.code === "23514";
    return json(referenceInvalid ? 422 : 500, {
      ok: false,
      code: referenceInvalid ? "CALL_REFERENCE_INVALID" : "CALL_INSERT_FAILED",
      message: referenceInvalid ? "The retained call needs a complete client reference before confirmation." : "The call remains saved locally and will retry.",
    });
  }
  const confirmed = await service.from("call_logs").select("log_id,user_id").eq("log_id", call.log_id).maybeSingle();
  if (confirmed.error || !confirmed.data) return json(500, { ok: false, code: "CALL_CONFIRMATION_FAILED", message: "The exact call could not be confirmed." });
  if (confirmed.data.user_id !== auth.user.id) return json(409, { ok: false, code: "CALL_ID_OWNERSHIP_COLLISION", message: "This call ID belongs to another account." });
  return json(200, { ok: true, code: insert.error ? "CALL_ALREADY_CONFIRMED" : "CALL_CONFIRMED", log_id: call.log_id });
}
