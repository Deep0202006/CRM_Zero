import { z } from "zod";
import { apiError, contextFor, distributorReadError } from "@/lib/distributors/server";
import { MasterTemplateOutdatedError, MAX_MASTER_WORKBOOK_BYTES, readMasterWorkbook, type ParsedMasterWorkbook } from "@/lib/distributorMaster/workbook";
import { MasterPlanRevalidationError, buildMasterImportPreview, revalidateMasterImportConfirmation } from "@/lib/distributorMaster/preview";
import { confirmMasterImport, MasterConfirmationError } from "@/lib/distributorMaster/confirmation";

export const runtime = "nodejs";

const fieldsSchema = z.object({
  mode: z.enum(["preview", "confirm"]),
  operation_id: z.string().uuid(),
  resolved_plan_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict().superRefine((value, issue) => {
  if (value.mode === "confirm" && !value.resolved_plan_hash) issue.addIssue({ code: "custom", path: ["resolved_plan_hash"], message: "Resolved plan hash is required." });
});

export async function POST(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  if (!context.isAdmin) return apiError(403, "ADMIN_REQUIRED", "System Administrator access required.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "MASTER_FORM_INVALID", "Upload one versioned XLSX master workbook.");
  }
  const parsedFields = fieldsSchema.safeParse({ mode: form.get("mode"), operation_id: form.get("operation_id"), resolved_plan_hash: form.get("resolved_plan_hash") || undefined });
  if (!parsedFields.success) return apiError(400, "MASTER_REQUEST_INVALID", parsedFields.error.issues[0]?.message ?? "Invalid master import request.");
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(400, "MASTER_FILE_REQUIRED", "Choose one versioned XLSX master workbook.");
  if (file.size > MAX_MASTER_WORKBOOK_BYTES) return apiError(413, "MASTER_FILE_TOO_LARGE", "Maximum workbook size is 10 MB.");
  let workbook: ParsedMasterWorkbook;
  try {
    workbook = readMasterWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (cause) {
    if (cause instanceof MasterTemplateOutdatedError) return apiError(400, cause.code, cause.message);
    return apiError(400, "MASTER_WORKBOOK_INVALID", cause instanceof Error ? cause.message : "The master workbook is invalid.");
  }
  try {
    if (parsedFields.data.mode === "preview") {
      return Response.json(await buildMasterImportPreview(context.service, workbook, parsedFields.data.operation_id));
    }
    const preview = await revalidateMasterImportConfirmation(context.service, workbook, parsedFields.data.operation_id, parsedFields.data.resolved_plan_hash!);
    return Response.json(await confirmMasterImport(context.service, context.userId, file.name, preview));
  } catch (cause) {
    if (cause instanceof MasterPlanRevalidationError) {
      if (cause.code === "IMPORT_REFRESH_REQUIRED") {
        return Response.json({ code: "IMPORT_REFRESH_REQUIRED", message: cause.message, preview: cause.preview }, { status: 409 });
      }
      return Response.json({ code: cause.code, message: cause.message, preview: cause.preview }, { status: 409 });
    }
    if (cause instanceof MasterConfirmationError) {
      return apiError(cause.uncertain ? 503 : 409, cause.code, cause.message);
    }
    return distributorReadError(cause as { code?: string }, "Master import authority could not be resolved.");
  }
}
