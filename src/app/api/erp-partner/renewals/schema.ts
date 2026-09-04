import { z } from "zod";
import { optionalCanonicalErpIdSchema } from "@/lib/erp/validation";

export const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(50),
    filter: z
      .enum(["all", "overdue", "today", "tomorrow", "in_two_days"])
      .default("all"),
    erp: optionalCanonicalErpIdSchema.default(""),
  })
  .strict();
