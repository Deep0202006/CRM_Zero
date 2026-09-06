import { callConfirmationSchema, hasCanonicalCallClientReference } from "@/lib/callLogs/serverContract";
import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
function tokenOf(request: Request) { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }

export async function POST(request: Request) {
  const serviceResult = createServerServiceClient(); const token = tokenOf(request);
  if (!serviceResult.ok) return backendUnavailableResponse();
  const service = serviceResult.client;
  if (!token) return json(401, { ok: false, code: "AUTH_REQUIRED", message: "Sign in again before retrying this call." });
  let input: unknown;
  try { input = await request.json(); } catch { return json(400, { ok: false, code: "CALL_VALIDATION_FAILED", message: "Call details could not be read." }); }
  const parsed = callConfirmationSchema.safeParse(input);
  if (!parsed.success) return json(400, { ok: false, code: "CALL_VALIDATION_FAILED", message: "Review the call details and retry." });
  const call = parsed.data;
  if (!hasCanonicalCallClientReference(call)) return json(422, { ok: false, code: "CALL_REFERENCE_INVALID", message: "The retained call needs a complete client reference before confirmation." });
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return json(401, { ok: false, code: "AUTH_REQUIRED", message: "Sign in again before retrying this call." });
  const { data: account, error: accountError } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (accountError || !account || !active(account.is_active)) return json(403, { ok: false, code: "ACCOUNT_INACTIVE", message: "An active employee account is required." });
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
