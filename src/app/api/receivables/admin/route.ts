import { apiError, contextFor, isReceivablesReady } from "@/lib/receivables/server";
import { listEligibleOperationalEmployees } from "@/lib/employees/server";
import { isDistributorCapabilityMissing } from "@/lib/distributors/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isReceivablesReady()) return apiError(503, "RECEIVABLES_UNAVAILABLE", "Payment Collections are not activated yet.");
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  if (!context.isAdmin) return apiError(403, "ADMIN_REQUIRED", "System Administrator access required.");
  const detailId = new URL(request.url).searchParams.get("receivable_id");
  if (detailId) {
    const [receivableResult, paymentResult, activityResult, identityResult] = await Promise.all([
      context.service.from("receivables_financial_read_v2").select("receivable_id,bill_reference,distributor_name,erp_id,erp_name,contact_person,contact_phone,bill_amount,confirmed_paid_amount,outstanding_amount,bill_due_date,next_follow_up_date,assigned_to,lifecycle_status,payment_state,alert_state,version,pending_payment_count,aging_bucket,promise_date").eq("receivable_id", detailId).maybeSingle(),
      context.service.from("receivable_payments").select("payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,verification_status,reported_by,reported_at,verified_by,verified_at,reversed_at", { count: "exact" }).eq("receivable_id", detailId).order("reported_at", { ascending: false }).range(0, 49),
      context.service.from("receivable_activity_events").select("activity_id,receivable_id,event_type,note,change_set,actor_id,created_at", { count: "exact" }).eq("receivable_id", detailId).order("created_at", { ascending: false }).range(0, 49),
      context.service.from("receivables").select("distributor_id,distributor_identity_key").eq("receivable_id", detailId).maybeSingle(),
    ]);
    if (receivableResult.error || paymentResult.error || activityResult.error || !receivableResult.data) return apiError(404, "RECEIVABLE_NOT_FOUND", "Receivable detail is unavailable.");
    let distributorStatus = null;
    let distributorStatusError: "CAPABILITY_MISSING" | "READ_FAILED" | null = null;
    if (identityResult.error) {
      distributorStatusError = isDistributorCapabilityMissing(identityResult.error) ? "CAPABILITY_MISSING" : "READ_FAILED";
    } else if (identityResult.data?.distributor_id) {
      const match = await context.service.from("distributor_accounts").select("distributor_id,erp_id,renewal_date").eq("distributor_id", identityResult.data.distributor_id).maybeSingle();
      if (match.error) distributorStatusError = isDistributorCapabilityMissing(match.error) ? "CAPABILITY_MISSING" : "READ_FAILED";
      else if (match.data) distributorStatus = { ...match.data, renewal_state: null };
    } else if (identityResult.data?.distributor_identity_key) {
      const matches = await context.service.from("distributor_accounts").select("distributor_id,renewal_date").eq("identity_key", identityResult.data.distributor_identity_key).limit(2);
      if (matches.error) distributorStatusError = isDistributorCapabilityMissing(matches.error) ? "CAPABILITY_MISSING" : "READ_FAILED";
      else if (matches.data?.length === 1) distributorStatus = { ...matches.data[0], renewal_state: null };
    }
    return Response.json({
      receivable: { ...receivableResult.data, owner_name: "Assigned employee" },
      payments: paymentResult.data,
      activity: activityResult.data,
      distributor_status: distributorStatus,
      distributor_status_error: distributorStatusError,
      history: { limit: 50, payment_count: paymentResult.count ?? 0, payment_has_more: (paymentResult.count ?? 0) > 50, activity_count: activityResult.count ?? 0, activity_has_more: (activityResult.count ?? 0) > 50 },
    });
  }
  const [metrics, pendingPayments, directory] = await Promise.all([
    context.service.rpc("receivables_admin_metrics_v1", { p_actor_id: context.userId }),
    context.service.from("receivable_payments").select("payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,reported_by,reported_at", { count: "exact" }).eq("verification_status", "reported").order("reported_at", { ascending: true }).range(0, 49),
    listEligibleOperationalEmployees(context.service),
  ]);
  if (metrics.error || pendingPayments.error) return apiError(503, "READ_FAILED", "Admin collection summary could not be loaded.");
  if (directory.error) return apiError(503, "EMPLOYEE_DIRECTORY_UNAVAILABLE", "Eligible employees could not be loaded.");
  const receivableIds = [...new Set((pendingPayments.data ?? []).map((row) => row.receivable_id))];
  const reporterIds = [...new Set((pendingPayments.data ?? []).map((row) => row.reported_by))];
  const [receivables, reporters] = await Promise.all([
    receivableIds.length ? context.service.from("receivables_financial_read_v1").select("receivable_id,distributor_name,bill_reference,outstanding_amount,version").in("receivable_id", receivableIds) : Promise.resolve({ data: [], error: null }),
    reporterIds.length ? context.service.from("users").select("user_id,name").in("user_id", reporterIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (receivables.error || reporters.error) return apiError(503, "READ_FAILED", "Pending payment context could not be loaded.");
  const bills = new Map((receivables.data ?? []).map((row) => [row.receivable_id, row]));
  const names = new Map((reporters.data ?? []).map((row) => [row.user_id, row.name]));
  return Response.json({ metrics: metrics.data, assignees: directory.employees, pending: (pendingPayments.data ?? []).map((row) => ({ ...row, receivable: bills.get(row.receivable_id), reporter_name: names.get(row.reported_by) ?? "Employee" })), pending_count: pendingPayments.count ?? 0, pending_has_more: (pendingPayments.count ?? 0) > 50 });
}
