import { z } from "zod";
import { canonicalErpIdSchema } from "@/lib/erp/validation";

export const UpdateSchema = z.object({
  user_id: z.string().uuid(),
  erp_scope_ids: z.array(canonicalErpIdSchema).min(1).max(100),
});
