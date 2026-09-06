import { z } from "zod";
import { apiError, contextFor, distributorReadError, requestHash } from "@/lib/distributors/server";
import { buildDistributorImportPreview } from "@/lib/distributors/importServer";

const row = z.object({ rowNumber: z.number().int().min(2).max(5001), distributorName: z.string().trim().min(1).max(200), assignedEmployeeEmail: z.string().email().max(254), installationStatus: z.enum(["pending", "done"]), installationDate: z.string().max(10), trainingStatus: z.enum(["pending", "done"]), trainingDate: z.string().max(10), mappingStatus: z.enum(["pending", "done"]), mappedDate: z.string().max(10), activityStatus: z.enum(["not_applicable", "active", "inactive"]), billingStatus: z.enum(["not_billed", "billed"]), billDate: z.string().max(10), billReference: z.string().max(120), renewalDate: z.string().max(10), distributorReference: z.string().max(80), erpName: z.string().max(160).default("") }).strict();
const requestSchema = z.object({ mode: z.enum(["preview", "confirm"]), operation_id: z.string().uuid(), filename: z.string().trim().min(1).max(255), preview_hash: z.string().optional(), rows: z.array(row).min(1).max(5000) }).strict();

export async function POST(request: Request) {
  const context = await contextFor(request); if (context instanceof Response) return context; if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again."); if (!context.isAdmin) return apiError(403, "ADMIN_REQUIRED", "System Administrator access required.");
  let raw: unknown; try { raw = await request.json(); } catch { return apiError(400, "INVALID_JSON", "Invalid import request."); }
  const parsed = requestSchema.safeParse(raw); if (!parsed.success) return apiError(400, "IMPORT_INVALID", parsed.error.issues[0]?.message ?? "Invalid import request.");
  let preview; try { preview = await buildDistributorImportPreview(context.service, parsed.data.operation_id, parsed.data.rows); } catch (error) { return distributorReadError(error as { code?: string }, "Authoritative import preview is temporarily unavailable."); }
  if (parsed.data.mode === "preview") return Response.json({ rows: preview.rows, counts: preview.counts, preview_hash: preview.preview_hash });
  if (parsed.data.preview_hash !== preview.preview_hash) return apiError(409, "IMPORT_REFRESH_REQUIRED", "Authoritative data changed after preview.");
  if ((preview.counts.AMBIGUOUS ?? 0) + (preview.counts.INVALID_EMPLOYEE ?? 0) + (preview.counts.ERP_REQUIRED ?? 0) > 0) return apiError(409, "IMPORT_REFRESH_REQUIRED", "Resolve ambiguous or invalid rows before confirming.");
  const canonicalRows = preview.rows.map((value) => ({ rowNumber: value.rowNumber, classification: value.classification, payload: "payload" in value ? value.payload : null })), hash = requestHash({ preview_hash: preview.preview_hash, rows: canonicalRows });
  const { data, error } = await context.service.rpc("import_distributor_status_v1", { p_operation_id: parsed.data.operation_id, p_actor_id: context.userId, p_request_hash: hash, p_filename: parsed.data.filename, p_rows: canonicalRows });
  if (error) { if (error.code === "ZD101") return apiError(409, "IMPORT_REFRESH_REQUIRED", "Distributor authority changed during import. Refresh preview."); return distributorReadError(error, "Import confirmation is uncertain. Retry with the same operation ID."); }
  if (!data.success) return apiError(data.code === "DISTRIBUTOR_CONFLICT" ? 409 : 400, data.code, "Import was rejected."); return Response.json(data);
}
