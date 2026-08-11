import { apiError, contextFor, isReceivablesReady, requestHash } from "@/lib/receivables/server";
import { createHash } from "crypto";
interface Row { rowNumber:number; billReference:string; distributorName:string; contactPerson:string; contactPhone:string; billAmount:string; billDueDate:string; nextFollowUpDate:string; assignedEmployeeEmail:string; distributorCode:string; notes:string }
type Accepted = Row & { classification:string; assigned_to:string; receivable_id:string };
function stableRowId(operationId:string,rowNumber:number){const hex=createHash("sha256").update(`${operationId}:${rowNumber}`).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
async function resolve(context:NonNullable<Awaited<ReturnType<typeof contextFor>>>,rows:Row[]){
 const emails=[...new Set(rows.map(r=>r.assignedEmployeeEmail.toLowerCase()))]; const {data,error}=await context.service.from("users").select("user_id,email,name,is_active").in("email",emails); if(error)throw error;
 const byEmail=new Map((data??[]).filter(u=>u.is_active===true||u.is_active===1).map(u=>[String(u.email).toLowerCase(),u]));
 return rows.map(row=>{const user=byEmail.get(row.assignedEmployeeEmail.toLowerCase());return user?{classification:"NEW",...row,assigned_to:user.user_id,receivable_id:crypto.randomUUID()}:{classification:"INVALID",...row,reason:"Assigned employee email is missing or inactive."}});
}
export async function POST(request:Request){
 if(!isReceivablesReady())return apiError(503,"RECEIVABLES_UNAVAILABLE","Payment Collections are not activated yet."); const context=await contextFor(request); if(!context)return apiError(401,"AUTH_REQUIRED","Sign in again."); if(!context.isAdmin)return apiError(403,"ADMIN_REQUIRED","System Administrator access required.");
 let body:{mode?:string;operation_id?:string;filename?:string;rows?:Row[]}; try{body=await request.json()}catch{return apiError(400,"INVALID_JSON","Invalid import request.")} if(!Array.isArray(body.rows)||body.rows.length>5000)return apiError(400,"IMPORT_INVALID","Import is limited to 5,000 rows.");
 let resolved:Awaited<ReturnType<typeof resolve>>; try{resolved=await resolve(context,body.rows)}catch{return apiError(503,"IMPORT_UNAVAILABLE","Employees could not be revalidated.")} const invalid=resolved.filter(r=>r.classification==="INVALID");
 if(body.mode!=="confirm")return Response.json({rows:resolved,counts:{new:resolved.length-invalid.length,invalid:invalid.length,duplicate:0,conflict:0},preview_hash:requestHash(resolved)}); if(invalid.length)return apiError(409,"IMPORT_REFRESH_REQUIRED","Import changed during revalidation. Refresh the preview.");
 const operationId=String(body.operation_id??""); const accepted=resolved.filter(r=>"assigned_to" in r) as Accepted[]; const rows=accepted.map(r=>({row_number:r.rowNumber,bill_reference:r.billReference,distributor_name:r.distributorName,contact_person:r.contactPerson,contact_phone:r.contactPhone,bill_amount:r.billAmount,bill_due_date:r.billDueDate,next_follow_up_date:r.nextFollowUpDate,assigned_to:r.assigned_to,distributor_code:r.distributorCode,notes:r.notes,receivable_id:stableRowId(operationId,r.rowNumber)}));
 const hash=requestHash({rows}); const {data,error}=await context.service.rpc("import_receivables_v1",{p_operation_id:operationId,p_actor_id:context.userId,p_request_hash:hash,p_filename:body.filename??"import",p_payload_hash:requestHash(rows),p_rows:rows});
 if(error)return apiError(503,"IMPORT_UNAVAILABLE","The import was not confirmed. Retry with the same operation."); if(!data.success)return apiError(409,data.code,"Import requires a refreshed preview."); return Response.json(data);
}
