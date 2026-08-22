import { apiError, contextFor, distributorReadError, externalViewerDenied } from "@/lib/distributors/server";
import { listEligibleOperationalEmployees } from "@/lib/employees/server";
import { listErpSystems } from "@/lib/erp/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const externalDenied = externalViewerDenied(context);
  if (externalDenied) return externalDenied;
  const [metrics, directory, erps] = await Promise.all([
    context.service.rpc("distributor_status_metrics_v1", { p_actor_id: context.userId, p_admin: context.isAdmin }),
    context.isAdmin ? listEligibleOperationalEmployees(context.service) : Promise.resolve({ employees: [], error: null }),
    context.isAdmin ? listErpSystems(context.service) : Promise.resolve([]),
  ]);
  if (metrics.error) return distributorReadError(metrics.error, "Distributor metrics could not be loaded.");
  if (!metrics.data || typeof metrics.data !== "object" || !Array.isArray((metrics.data as { erp_distribution?: unknown }).erp_distribution))
    return apiError(503, "DISTRIBUTOR_CAPABILITY_MISSING", "Distributor ERP footprint requires the reviewed Owner Migration 050.");
  if (directory.error) return apiError(503, "EMPLOYEE_DIRECTORY_UNAVAILABLE", "Eligible employees could not be loaded.");
  return Response.json({ metrics: metrics.data, assignees: directory.employees, erps });
}
