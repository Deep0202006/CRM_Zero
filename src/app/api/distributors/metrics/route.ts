import { apiError, contextFor, distributorReadError } from "@/lib/distributors/server";
import { listEligibleOperationalEmployees } from "@/lib/employees/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const [metrics, directory] = await Promise.all([
    context.service.rpc("distributor_status_metrics_v1", { p_actor_id: context.userId, p_admin: context.isAdmin }),
    context.isAdmin ? listEligibleOperationalEmployees(context.service) : Promise.resolve({ employees: [], error: null }),
  ]);
  if (metrics.error) return distributorReadError(metrics.error, "Distributor metrics could not be loaded.");
  if (directory.error) return apiError(503, "EMPLOYEE_DIRECTORY_UNAVAILABLE", "Eligible employees could not be loaded.");
  return Response.json({ metrics: metrics.data, assignees: directory.employees });
}
