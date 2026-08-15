import { apiError, contextFor, distributorReadError } from "@/lib/distributors/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const rawLimit = Number.parseInt(new URL(request.url).searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 50;
  const { data, error } = await context.service.rpc("distributor_renewals_due_v1", { p_actor_id: context.userId, p_admin: context.isAdmin, p_limit: limit });
  if (error) return distributorReadError(error, "Renewal reminders could not be loaded.");
  return Response.json({ enabled: true, ...data });
}
