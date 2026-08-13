import { z } from "zod";
import { activityStatuses, billingStatuses, installationStatuses, trainingStatuses, validateStatusCombination } from "./domain";

const uuid=z.string().uuid(), date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/), optionalDate=z.union([date,z.literal(""),z.null()]).transform(value=>value||null);
const fields=z.object({
 distributor_name:z.string().trim().min(1).max(200), distributor_reference:z.string().trim().max(80).default(""), lead_id:z.union([uuid,z.literal(""),z.null()]).default(null), phone:z.string().trim().max(40).default(""), city:z.string().trim().max(120).default(""), assigned_to:uuid,
 installation_status:z.enum(installationStatuses), installation_completed_at:optionalDate,
 training_status:z.enum(trainingStatuses), training_completed_at:optionalDate,
 activity_status:z.enum(activityStatuses), billing_status:z.enum(billingStatuses), billed_at:optionalDate,
 bill_reference:z.string().trim().max(120).default(""), renewal_date:optionalDate,
});
export const distributorCreateSchema=fields.superRefine((value,ctx)=>{const message=validateStatusCombination(value);if(message)ctx.addIssue({code:"custom",path:["activity_status"],message});});
export const distributorUpdateSchema=distributorCreateSchema.and(z.object({distributor_id:uuid,expected_version:z.number().int().nonnegative(),note:z.string().trim().max(1000).default("")}));
export const distributorCommandSchema=z.object({operation_id:uuid,operation_type:z.enum(["create","update","renew"]),payload:z.record(z.string(),z.unknown())}).strict();
export const distributorListSchema=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(50),search:z.string().trim().max(100).default(""),assignedTo:z.string().default(""),installation:z.string().default(""),training:z.string().default(""),activity:z.string().default(""),billing:z.string().default(""),renewal:z.string().default("")});
