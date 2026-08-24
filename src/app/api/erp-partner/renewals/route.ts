import { z } from "zod";
import { apiError, contextFor } from "@/lib/receivables/server";
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
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  if (!context.isErpPartnerViewer)
    return apiError(
      403,
      "ERP_PARTNER_REQUIRED",
      "ERP Partner Viewer access required.",
    );
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return apiError(
      400,
      "INVALID_FILTERS",
      parsed.error.issues[0]?.message ?? "Invalid filters.",
    );
  const { data, error } = await context.service.rpc("erp_partner_renewals_v1", {
    p_actor_id: context.userId,
    p_erp_id: parsed.data.erp || null,
    p_filter: parsed.data.filter,
    p_page: parsed.data.page,
    p_page_size: parsed.data.pageSize,
  });
  if (error)
    return apiError(
      503,
      "ERP_PARTNER_READ_FAILED",
      "ERP Renewals are unavailable.",
    );
  return Response.json(data);
}
