import { apiError, contextFor, isReceivablesReady, requestHash } from "@/lib/receivables/server";
import { buildImportPreview } from "@/lib/receivables/importServer";
import { importRequestSchema } from "@/lib/receivables/validation";

export async function POST(request:Request){
 if(!isReceivablesReady())return apiError(503,"RECEIVABLES_UNAVAILABLE","Payment Collections are not activated yet.");const context=await contextFor(request);if(!context)return apiError(401,"AUTH_REQUIRED","Sign in again.");if(!context.isAdmin)return apiError(403,"ADMIN_REQUIRED","System Administrator access required.");
 let raw:unknown;try{raw=await request.json()}catch{return apiError(400,"INVALID_JSON","Invalid import request.")}const parsed=importRequestSchema.safeParse(raw);if(!parsed.success)return apiError(400,"IMPORT_INVALID",parsed.error.issues[0]?.message??"Invalid import request.");
 let preview;try{preview=await buildImportPreview(context.service,parsed.data.operation_id,parsed.data.rows)}catch{return apiError(503,"IMPORT_UNAVAILABLE","Authoritative import preview is temporarily unavailable.")}
 if(parsed.data.mode==="preview")return Response.json({rows:preview.rows,counts:preview.counts,preview_hash:preview.preview_hash});
 if(parsed.data.preview_hash!==preview.preview_hash)return apiError(409,"IMPORT_REFRESH_REQUIRED","Authoritative data changed after preview. Refresh before confirming.");
 if(preview.counts.conflict||preview.counts.invalid)return apiError(409,"IMPORT_REFRESH_REQUIRED","Resolve conflicts and invalid rows before confirming.");
 const hash=requestHash({preview_hash:preview.preview_hash,rows:preview.resolvedRows}),payloadHash=requestHash(preview.resolvedRows);const {data,error}=await context.service.rpc("import_receivables_v1",{p_operation_id:parsed.data.operation_id,p_actor_id:context.userId,p_request_hash:hash,p_filename:parsed.data.filename,p_payload_hash:payloadHash,p_rows:preview.resolvedRows});if(error){if(error.code==="ZD001")return apiError(409,"IMPORT_EMPLOYEE_CHANGED","An assignee is no longer an active operational employee. Refresh the preview.");return apiError(503,"IMPORT_UNAVAILABLE","The import was not confirmed. Retry with the same operation.");}if(!data.success)return apiError(409,data.code,"Import requires a refreshed preview.");return Response.json(data);
}
