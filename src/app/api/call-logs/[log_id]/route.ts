import { callOwnerUpdateSchema, hasCanonicalCallClientReference } from "@/lib/callLogs/serverContract";
import { createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { isSyntheticAuditCall } from "@/lib/workMetrics/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
function tokenOf(request: Request) { const value = request.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; }
export async function PATCH(request: Request, { params }: { params: Promise<{ log_id: string }> }) {
  const serviceResult = createServerServiceClient(); const token = tokenOf(request); const { log_id } = await params;
  if (!serviceResult.ok) return json(503, { ok: false, code: "BACKEND_UNAVAILABLE", reason: serviceResult.reason });
  const service = serviceResult.client;
  if (!token) return json(401, { ok: false, code: "AUTH_REQUIRED", message: "Sign in again before retrying this update." });
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return json(401, { ok: false, code: "AUTH_REQUIRED", message: "Sign in again before retrying this update." });
  const { data: account, error: accountError } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (accountError || !account || !active(account.is_active)) return json(403, { ok: false, code: "ACCOUNT_INACTIVE", message: "An active employee account is required." });
  const existing = await service.from("call_logs").select("log_id,user_id,lead_id,client_username,client_name,timestamp,outcome,notes,next_followup_date").eq("log_id", log_id).maybeSingle();
  if (existing.error) return json(500, { ok: false, code: "CALL_UPDATE_FAILED", message: "The exact call could not be checked safely." });
  if (!existing.data) return json(404, { ok: false, code: "CALL_NOT_FOUND", message: "The exact call was not found." });
  if (existing.data.user_id !== auth.user.id) return json(403, { ok: false, code: "CALL_UPDATE_NOT_OWNER", message: "Only the employee who logged this call may update it." });
  if (isSyntheticAuditCall(existing.data)) return json(422, { ok: false, code: "CALL_SYNTHETIC_IMMUTABLE", message: "Synthetic audit rows cannot be edited as business calls." });
  let input: unknown;
  try { input = await request.json(); } catch { return json(400, { ok: false, code: "CALL_VALIDATION_FAILED", message: "Call details could not be read." }); }
  const parsed = callOwnerUpdateSchema.safeParse(input);
  if (!parsed.success) return json(400, { ok: false, code: "CALL_VALIDATION_FAILED", message: "Review the call details and retry." });
  if (!hasCanonicalCallClientReference(parsed.data)) return json(422, { ok: false, code: "CALL_REFERENCE_INVALID", message: "A complete client reference is required." });
  const updated = await service.from("call_logs").update({
    lead_id: parsed.data.lead_id,
    client_username: parsed.data.client_username ?? null,
    client_name: parsed.data.client_name ?? null,
    outcome: parsed.data.outcome,
    notes: parsed.data.notes ?? null,
    next_followup_date: parsed.data.next_followup_date ?? null,
  }).eq("log_id", log_id).eq("user_id", auth.user.id).select("log_id,user_id,lead_id,client_username,client_name,timestamp,outcome,notes,next_followup_date").maybeSingle();
  if (updated.error) return json(updated.error.code === "23514" ? 422 : 500, { ok: false, code: updated.error.code === "23514" ? "CALL_REFERENCE_INVALID" : "CALL_UPDATE_FAILED", message: "The call update was not confirmed." });
  if (!updated.data) return json(403, { ok: false, code: "CALL_UPDATE_NOT_OWNER", message: "Only the employee who logged this call may update it." });
  return json(200, { ok: true, code: "CALL_UPDATED", call: updated.data });
}
