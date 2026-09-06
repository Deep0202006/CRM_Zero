import { apiError, contextFor, isReceivablesReady } from "@/lib/receivables/server";

export const dynamic = "force-dynamic";

const emptyRenewals = { total: 0, rows: [] };

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (context instanceof Response) return context;
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const receivablesEnabled = isReceivablesReady();
  const renewalPromise = context.service.rpc("distributor_renewals_due_v1", { p_actor_id: context.userId, p_admin: context.isAdmin, p_limit: 5 });
  if (context.isAdmin) {
    const [payments, renewals] = await Promise.all([
      receivablesEnabled ? context.service.from("receivable_payments").select("payment_id", { count: "exact", head: true }).eq("verification_status", "reported") : Promise.resolve({ count: 0, error: null }),
      renewalPromise,
    ]);
    if (payments.error) return apiError(503, "READ_FAILED", "Payment Collection priorities could not be loaded.");
    return Response.json({ enabled: true, admin: true, verificationPending: payments.count ?? 0, urgentCount: 0, outstandingAmount: "0.00", rows: [], renewals_due_soon: renewals.error ? emptyRenewals : renewals.data ?? emptyRenewals, renewals_error: renewals.error ? "UNAVAILABLE" : null });
  }
  const [collections, renewals] = await Promise.all([
    receivablesEnabled ? context.service.rpc("receivables_my_day_v1", { p_actor_id: context.userId }) : Promise.resolve({ data: { urgentCount: 0, outstandingAmount: "0.00", rows: [] }, error: null }),
    renewalPromise,
  ]);
  if (collections.error) return apiError(503, "READ_FAILED", "Payment Collection priorities could not be loaded.");
  return Response.json({ enabled: true, ...collections.data, renewals_due_soon: renewals.error ? emptyRenewals : renewals.data ?? emptyRenewals, renewals_error: renewals.error ? "UNAVAILABLE" : null });
}
