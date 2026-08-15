import { apiError, contextFor, distributorReadError } from "@/lib/distributors/server";

export const dynamic = "force-dynamic";

type DistributorRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, routeContext: DistributorRouteContext) {
  const auth = await contextFor(request);
  if (!auth) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const { id } = await routeContext.params;
  const [record, events] = await Promise.all([
    auth.userClient.from("distributor_accounts").select("distributor_id,distributor_name,distributor_reference,phone,city,identity_key,lead_id,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,version,updated_at").eq("distributor_id", id).maybeSingle(),
    auth.userClient.from("distributor_status_events").select("event_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id,created_at", { count: "exact" }).eq("distributor_id", id).order("created_at", { ascending: false }).range(0, 49),
  ]);
  if (record.error) {
    if (record.error.code === "PGRST116") return apiError(404, "DISTRIBUTOR_NOT_FOUND", "Distributor Status is unavailable.");
    return distributorReadError(record.error);
  }
  if (!record.data) return apiError(404, "DISTRIBUTOR_NOT_FOUND", "Distributor Status is unavailable.");
  if (events.error) return distributorReadError(events.error, "Distributor history could not be loaded.");
  return Response.json({ record: record.data, events: events.data ?? [], history: { count: events.count ?? 0, has_more: (events.count ?? 0) > 50 } });
}
