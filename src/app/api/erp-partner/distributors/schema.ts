import { z } from "zod";
import { optionalCanonicalErpIdSchema } from "@/lib/erp/validation";

export const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(50),
    search: z.string().trim().max(100).default(""),
    erp: optionalCanonicalErpIdSchema.default(""),
    installation: z.enum(["", "pending", "done"]).default(""),
    training: z.enum(["", "pending"]).default(""),
    billing: z.enum(["", "not_billed", "billed"]).default(""),
    activity: z.enum(["", "active"]).default(""),
    erpPayment: z.enum(["", "paid"]).default(""),
    renewal: z.enum(["", "due_soon", "overdue"]).default(""),
  })
  .strict();
