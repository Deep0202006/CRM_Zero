import { normalizedIdentity } from "@/lib/distributors/domain";
import { apiError, contextFor, distributorReadError, externalViewerDenied, requestHash, stableDistributorId } from "@/lib/distributors/server";
import { distributorCommandSchema, distributorCreateSchema, distributorErpPaymentSchema, distributorRenewSchema, distributorUpdateSchema } from "@/lib/distributors/validation";
import { resolveErpNames } from "@/lib/erp/server";

export async function POST(request: Request) {
  const context = await contextFor(request);
  if (context instanceof Response) return context;
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const externalDenied = externalViewerDenied(context);
  if (externalDenied) return externalDenied;
  let raw: unknown;
  try { raw = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Invalid request."); }
  const command = distributorCommandSchema.safeParse(raw);
  if (!command.success) return apiError(400, "INVALID_COMMAND", command.error.issues[0]?.message ?? "Invalid command.");
  if (!context.isAdmin && command.data.operation_type !== "renew") return apiError(403, "ADMIN_REQUIRED", "System Administrator access required.");
  let payload: Record<string, unknown>;
  let rpc = "distributor_status_command_v1";
  if (command.data.operation_type === "create") {
    const parsed = distributorCreateSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid distributor status.");
    const erp = (await resolveErpNames(context.service, [parsed.data.erp_name!])).get(parsed.data.erp_name!.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN"))!;
    const { erp_action: _erpAction, ...fields } = parsed.data;
    void _erpAction;
    payload = { ...fields, erp_id: erp.erp_id, erp_name: erp.erp_name, distributor_id: stableDistributorId(command.data.operation_id), identity_key: normalizedIdentity(parsed.data.distributor_name, parsed.data.distributor_reference) };
  } else if (command.data.operation_type === "update") {
    const parsed = distributorUpdateSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid distributor status.");
    const { erp_action: erpAction, ...fields } = parsed.data;
    let erpPatch: Record<string, unknown> = {};
    if (erpAction === "set" && parsed.data.erp_name) {
      const erp = (await resolveErpNames(context.service, [parsed.data.erp_name])).get(parsed.data.erp_name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN"))!;
      erpPatch = { erp_id: erp.erp_id, erp_name: erp.erp_name };
    } else if (erpAction === "clear") erpPatch = { erp_id: null };
    payload = { ...fields, ...erpPatch, identity_key: normalizedIdentity(parsed.data.distributor_name, parsed.data.distributor_reference) };
  } else if (command.data.operation_type === "renew") {
    const parsed = distributorRenewSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid renewal.");
    payload = parsed.data;
  } else {
    const parsed = distributorErpPaymentSchema.safeParse(command.data.payload);
    if (!parsed.success) return apiError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid ERP payment status.");
    payload = parsed.data;
    rpc = "distributor_erp_payment_status_command_v1";
  }
  const hash = requestHash({ operation_type: command.data.operation_type, payload });
  const { data, error } = await context.service.rpc(rpc, { p_operation_id: command.data.operation_id, p_actor_id: context.userId, p_operation_type: command.data.operation_type, p_request_hash: hash, p_payload: payload });
  if (error) return distributorReadError(error, "The update was not confirmed. Retry with the same operation ID.");
  if (!data.success) {
    const code = String(data.code ?? "DISTRIBUTOR_COMMAND_REJECTED");
    const status = code === "DISTRIBUTOR_NOT_FOUND" ? 404
      : ["DISTRIBUTOR_CONFLICT", "DISTRIBUTOR_DUPLICATE", "DISTRIBUTOR_OPERATION_MISMATCH"].includes(code) ? 409
      : ["ADMIN_REQUIRED", "DISTRIBUTOR_NOT_ASSIGNED"].includes(code) ? 403
      : code === "ERP_PAYMENT_STATUS_REQUIRES_BILLED" ? 409
      : 400;
    const message = code === "DISTRIBUTOR_CONFLICT"
      ? "Distributor status changed. Refresh and try again."
      : code === "ERP_PAYMENT_STATUS_REQUIRES_BILLED"
        ? "ERP payment status is available only while the Distributor is billed."
        : code === "ADMIN_REQUIRED"
          ? "System Administrator access required."
          : "Distributor update was rejected.";
    return apiError(status, code, message, data.current);
  }
  return Response.json(data);
}
