import { z } from "zod";
import { isSyntheticAuditCall } from "@/lib/workMetrics/canonical";

const callBusinessShape = {
  lead_id: z.string().uuid().nullable(),
  client_username: z.string().trim().min(1).max(250).nullable().optional(),
  client_name: z.string().trim().min(1).max(500).nullable().optional(),
  outcome: z.string().trim().min(1).max(2000),
  notes: z.string().max(5000).nullable().optional(),
  next_followup_date: z.string().nullable().optional(),
};

const validateBusinessFacts = (call: z.infer<z.ZodObject<typeof callBusinessShape>>, context: z.RefinementCtx) => {
  if (call.next_followup_date && Number.isNaN(Date.parse(call.next_followup_date))) context.addIssue({ code: "custom", path: ["next_followup_date"], message: "Invalid follow-up date" });
  if (isSyntheticAuditCall(call)) context.addIssue({ code: "custom", path: ["outcome"], message: "Synthetic audit rows are immutable" });
};

export const hasCanonicalCallClientReference = (call: z.infer<z.ZodObject<typeof callBusinessShape>>) =>
  Boolean(call.lead_id || (call.client_username?.trim() && call.client_name?.trim()));

export const callConfirmationSchema = z.object({
  log_id: z.string().uuid(),
  user_id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  ...callBusinessShape,
}).strict().superRefine(validateBusinessFacts);

export const callOwnerUpdateSchema = z.object(callBusinessShape).strict().superRefine(validateBusinessFacts);
