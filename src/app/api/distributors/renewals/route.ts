import { apiError, contextFor, distributorReadError, externalViewerDenied } from "@/lib/distributors/server";
import { renewalReadSchema } from "@/lib/distributors/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const externalDenied = externalViewerDenied(context);
  if (externalDenied) return externalDenied;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = renewalReadSchema.safeParse({ ...params, view: params.view ?? "legacy" });
  if (!parsed.success) return apiError(400, "INVALID_RENEWAL_QUERY", parsed.error.issues[0]?.message ?? "Invalid renewal query.");
  const query = parsed.data;
  const operation = query.view === "metrics"
    ? context.service.rpc("distributor_renewal_metrics_v1", { p_actor_id: context.userId, p_admin: context.isAdmin })
    : query.view === "list"
      ? context.service.rpc("distributor_renewals_list_v2", { p_actor_id: context.userId, p_admin: context.isAdmin, p_filter: query.filter, p_page: query.page, p_page_size: query.pageSize, p_erp_id: query.erp || null, p_erp_unset: query.erpUnset === "true" })
      : context.service.rpc("distributor_renewals_due_v2", { p_actor_id: context.userId, p_admin: context.isAdmin, p_limit: query.limit });
  const { data, error } = await operation;
  if (error) return distributorReadError(error, "Renewal reminders could not be loaded.");
  return Response.json(query.view === "metrics" ? { enabled: true, metrics: data } : { enabled: true, ...data });
}
