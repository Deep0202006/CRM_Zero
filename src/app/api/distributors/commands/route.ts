import { normalizedIdentity } from "@/lib/distributors/domain";
import { apiError, contextFor, distributorReadError, requestHash, stableDistributorId } from "@/lib/distributors/server";
import { distributorCommandSchema, distributorCreateSchema, distributorRenewSchema, distributorUpdateSchema } from "@/lib/distributors/validation";

export async function POST(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  let raw: unknown;
  try { raw = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Invalid request."); }
  const command = distributorCommandSchema.safeParse(raw);
  if (!command.success) return apiError(400, "INVALID_COMMAND", command.error.issues[0]?.message ?? "Invalid command.");
  if (!context.isAdmin && command.data.operation_type !== "renew") return apiError(403, "ADMIN_REQUIRED", "System Administrator access required.");
  let payload: Record<string, unknown>;
  if (command.data.operation_type === "create") {
    const parsed = distributorCreateSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid distributor status.");
    payload = { ...parsed.data, distributor_id: stableDistributorId(command.data.operation_id), identity_key: normalizedIdentity(parsed.data.distributor_name, parsed.data.distributor_reference) };
  } else if (command.data.operation_type === "update") {
    const parsed = distributorUpdateSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid distributor status.");
    payload = { ...parsed.data, identity_key: normalizedIdentity(parsed.data.distributor_name, parsed.data.distributor_reference) };
  } else {
    const parsed = distributorRenewSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid renewal.");
    payload = parsed.data;
  }
  const hash = requestHash({ operation_type: command.data.operation_type, payload });
  const { data, error } = await context.service.rpc("distributor_status_command_v1", { p_operation_id: command.data.operation_id, p_actor_id: context.userId, p_operation_type: command.data.operation_type, p_request_hash: hash, p_payload: payload });
  if (error) return distributorReadError(error, "The update was not confirmed. Retry with the same operation ID.");
  if (!data.success) {
    const code = String(data.code ?? "DISTRIBUTOR_COMMAND_REJECTED");
    const status = code === "DISTRIBUTOR_NOT_FOUND" ? 404
      : ["DISTRIBUTOR_CONFLICT", "DISTRIBUTOR_DUPLICATE", "DISTRIBUTOR_OPERATION_MISMATCH"].includes(code) ? 409
      : ["ADMIN_REQUIRED", "DISTRIBUTOR_NOT_ASSIGNED"].includes(code) ? 403
      : 400;
    return apiError(status, code, "Distributor update was rejected.", data.current);
  }
  return Response.json(data);
}
