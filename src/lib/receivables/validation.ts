import { z } from "zod";
import { canonicalErpIdSchema } from "@/lib/erp/validation";

const uuid=z.string().uuid();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,"Use YYYY-MM-DD.").refine(value=>{const [year,month,day]=value.split("-").map(Number),parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day},"Enter a valid calendar date.");
const money=z.string().regex(/^\d{1,12}\.\d{2}$/,"Use a canonical positive amount with two decimals.").refine(value=>value!=="0.00","Amount must be greater than zero.");
const optionalText=(max:number)=>z.string().trim().max(max).optional();
const requiredText=(max:number)=>z.string().trim().min(1).max(max);
const existing=z.object({receivable_id:uuid,expected_version:z.number().int().positive()}).strict();

export const receivablePayloadSchemas={
 create:z.object({receivable_id:uuid,distributor_id:uuid.optional(),bill_reference:requiredText(120),distributor_name:optionalText(200).default(""),distributor_code:optionalText(80).default(""),contact_person:requiredText(160),contact_phone:optionalText(40).default(""),bill_amount:money,bill_due_date:date,next_follow_up_date:date,assigned_to:uuid,note:optionalText(1000).default("")}).strict().superRefine((value,context)=>{if(!value.distributor_id&&!value.distributor_name)context.addIssue({code:z.ZodIssueCode.custom,path:["distributor_name"],message:"Distributor Name is required for legacy Receivables creation."})}),
 contacted:existing.extend({next_follow_up_date:date,note:optionalText(1000)}).strict(),
 no_response:existing.extend({next_follow_up_date:date,note:optionalText(1000)}).strict(),
 promise:existing.extend({promise_date:date,promise_amount:money.optional(),note:optionalText(1000)}).strict(),
 payment_report:existing.extend({payment_id:uuid,amount:money,payment_date:date,payment_mode:optionalText(60),payment_reference:optionalText(160),note:optionalText(1000)}).strict(),
 confirm_payment:existing.extend({payment_id:uuid,next_follow_up_date:date.optional()}).strict(),
 reject_payment:existing.extend({payment_id:uuid,reason:requiredText(500)}).strict(),
 reverse_payment:existing.extend({payment_id:uuid,reason:requiredText(500),next_follow_up_date:date.optional()}).strict(),
 direct_payment:existing.extend({payment_id:uuid,amount:money,payment_date:date,payment_mode:optionalText(60),payment_reference:optionalText(160),note:optionalText(1000),next_follow_up_date:date.optional()}).strict(),
 reassign:existing.extend({assigned_to:uuid,note:optionalText(1000)}).strict(),
 update:existing.extend({bill_amount:money.optional(),contact_person:requiredText(160).optional(),contact_phone:z.string().trim().max(40).optional(),bill_due_date:date.optional(),next_follow_up_date:date.optional(),note:optionalText(1000)}).strict().refine(value=>Object.keys(value).some(key=>!["receivable_id","expected_version","note"].includes(key)),"At least one correction is required."),
 dispute:existing.extend({reason:requiredText(500)}).strict(),
 resolve_dispute:existing.extend({note:optionalText(1000)}).strict(),
 cancel:existing.extend({reason:requiredText(500)}).strict(),
} as const;

export type ReceivableOperationType=keyof typeof receivablePayloadSchemas;
export function isReceivableOperationType(value:string):value is ReceivableOperationType{return value in receivablePayloadSchemas;}

export function parseReceivableCommand(input:unknown){
 const envelope=z.object({operation_id:uuid,operation_type:z.string(),payload:z.unknown()}).strict().safeParse(input);
 if(!envelope.success)return {success:false as const,issues:envelope.error.issues};
 if(!isReceivableOperationType(envelope.data.operation_type))return {success:false as const,issues:[{message:"Unknown Receivables operation type."}]};
 const payload=receivablePayloadSchemas[envelope.data.operation_type].safeParse(envelope.data.payload);
 if(!payload.success)return {success:false as const,issues:payload.error.issues};
 return {success:true as const,data:{operation_id:envelope.data.operation_id,operation_type:envelope.data.operation_type,payload:payload.data}};
}

export const importRowSchema=z.object({
 rowNumber:z.number().int().min(2).max(5001),billReference:requiredText(120),distributorName:requiredText(200),contactPerson:requiredText(160),contactPhone:z.string().trim().max(40),billAmount:money,billDueDate:date,nextFollowUpDate:date,assignedEmployeeEmail:z.string().trim().toLowerCase().email().max(254),distributorCode:z.string().trim().max(80),notes:z.string().max(1000),
}).strict();
export const importRequestSchema=z.object({mode:z.enum(["preview","confirm"]),operation_id:uuid,filename:requiredText(255),preview_hash:z.string().length(64).optional(),rows:z.array(importRowSchema).min(1).max(5000)}).strict();

const optionalDateParam=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
export const receivablesFilterSchema=z.object({
 page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),search:z.string().trim().max(120).optional(),owner:uuid.optional(),paymentState:z.enum(["Unpaid","Partially Paid","Paid","Disputed","Cancelled"]).optional(),alertState:z.enum(["payment_verification_pending","promise_overdue","followup_overdue","promise_due_today","followup_due_today","upcoming","disputed","none"]).optional(),aging:z.enum(["Current","1-7 days","8-15 days","16-30 days","31+ days"]).optional(),billDueFrom:optionalDateParam,billDueTo:optionalDateParam,followUpFrom:optionalDateParam,followUpTo:optionalDateParam,
 erp:canonicalErpIdSchema.optional(),erpUnset:z.enum(["true"]).optional(),
}).strict();
export type ReceivablesFilters=z.infer<typeof receivablesFilterSchema>;
export function parseReceivablesFilters(url:URL){const values=Object.fromEntries([...url.searchParams.entries()].filter(([,value])=>value!==""));return receivablesFilterSchema.safeParse(values)}
