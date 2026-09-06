import { apiError, contextFor } from "@/lib/receivables/server";
import { querySchema } from "./schema";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const context = await contextFor(request);
  if (context instanceof Response) return context;
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
  const { data, error } = await context.service.rpc(
    "erp_partner_distributors_v2",
    {
      p_actor_id: context.userId,
      p_erp_id: parsed.data.erp || null,
      p_search: parsed.data.search || null,
      p_page: parsed.data.page,
      p_page_size: parsed.data.pageSize,
      p_installation_filter: parsed.data.installation || null,
      p_training_filter: parsed.data.training || null,
      p_billing_filter: parsed.data.billing || null,
      p_activity_filter: parsed.data.activity || null,
      p_erp_payment_filter: parsed.data.erpPayment || null,
      p_renewal_filter: parsed.data.renewal || null,
    },
  );
  if (error)
    return apiError(
      503,
      "ERP_PARTNER_READ_FAILED",
      "ERP Distributor Status is unavailable.",
    );
  return Response.json(data);
}
