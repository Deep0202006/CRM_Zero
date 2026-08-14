import { z } from "zod";
import { activityStatuses, billingStatuses, installationStatuses, mappingStatuses, trainingStatuses, validateStatusCombination } from "./domain";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = z.union([date, z.literal(""), z.null()]).transform((value) => value || null);
const commonFields = {
  distributor_name: z.string().trim().min(1).max(200),
  distributor_reference: z.string().trim().max(80).default(""),
  lead_id: z.union([uuid, z.literal(""), z.null()]).default(null),
  phone: z.string().trim().max(40).default(""),
  city: z.string().trim().max(120).default(""),
  assigned_to: uuid,
  installation_status: z.enum(installationStatuses),
  installation_completed_at: optionalDate,
  training_status: z.enum(trainingStatuses),
  training_completed_at: optionalDate,
  mapped_at: optionalDate,
  activity_status: z.enum(activityStatuses),
  billing_status: z.enum(billingStatuses),
  billed_at: optionalDate,
  bill_reference: z.string().trim().max(120).default(""),
  renewal_date: optionalDate,
  note: z.string().trim().max(1000).default(""),
};

const validate = (value: { installation_status: string; training_status: string; mapping_status?: string | null; mapped_at?: string | null; activity_status: string }, context: z.RefinementCtx) => {
  const message = validateStatusCombination(value);
  if (message) context.addIssue({ code: "custom", path: message.startsWith("Mapping") || message.startsWith("Mapped") ? ["mapping_status"] : ["activity_status"], message });
};

export const distributorCreateSchema = z.object({ ...commonFields, mapping_status: z.enum(mappingStatuses).default("pending") }).strict().superRefine(validate);
export const distributorUpdateSchema = z.object({ ...commonFields, mapping_status: z.enum(mappingStatuses).nullable(), distributor_id: uuid, expected_version: z.number().int().positive() }).strict().superRefine(validate);
export const distributorRenewSchema = z.object({ distributor_id: uuid, expected_version: z.number().int().positive(), renewal_date: date, note: z.string().trim().max(1000).default("") }).strict();
export const distributorCommandSchema = z.object({ operation_id: uuid, operation_type: z.enum(["create", "update", "renew"]), payload: z.record(z.string(), z.unknown()) }).strict();
export const distributorListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(50), search: z.string().trim().max(100).default(""),
  assignedTo: z.union([uuid, z.literal("")]).default(""),
  installation: z.enum(["", ...installationStatuses]).default(""),
  training: z.enum(["", ...trainingStatuses]).default(""),
  mapping: z.enum(["", ...mappingStatuses]).default(""),
  activity: z.enum(["", ...activityStatuses]).default(""),
  billing: z.enum(["", ...billingStatuses]).default(""),
  renewal: z.enum(["", "due_soon"]).default(""),
});
