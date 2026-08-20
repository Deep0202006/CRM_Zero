import {
  apiError,
  contextFor,
  externalViewerDenied,
  isReceivablesReady,
} from "@/lib/receivables/server";
import { applyReceivableFilters } from "@/lib/receivables/filters";
import { parseReceivablesFilters } from "@/lib/receivables/validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isReceivablesReady())
    return apiError(
      503,
      "RECEIVABLES_UNAVAILABLE",
      "Payment Collections are not activated yet.",
    );
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  const externalDenied = externalViewerDenied(context);
  if (externalDenied) return externalDenied;
  const parsed = parseReceivablesFilters(new URL(request.url));
  if (!parsed.success)
    return apiError(
      400,
      "INVALID_FILTER",
      parsed.error.issues[0]?.message ?? "Invalid filter.",
    );
  if (parsed.data.owner && !context.isAdmin)
    return apiError(
      403,
      "ADMIN_REQUIRED",
      "Owner filtering requires System Administrator access.",
    );
  const { page, pageSize } = parsed.data,
    from = (page - 1) * pageSize;
  // The two projections intentionally have different row shapes. Keep their fluent
  // builders erased here and restore the shared API shape after the bounded read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = context.isAdmin
    ? context.service
        .from("receivables_financial_read_v2")
        .select(
          "receivable_id,bill_reference,distributor_name,erp_id,erp_name,contact_person,contact_phone,bill_amount,confirmed_paid_amount,outstanding_amount,bill_due_date,next_follow_up_date,assigned_to,lifecycle_status,payment_state,alert_state,version,pending_payment_count,aging_bucket,promise_date,collection_priority,collection_sort_date",
          { count: "exact" },
        )
    : context.userClient
        .from("receivables_financial_read_v1")
        .select(
          "receivable_id,bill_reference,distributor_name,contact_person,contact_phone,bill_amount,confirmed_paid_amount,outstanding_amount,bill_due_date,next_follow_up_date,assigned_to,lifecycle_status,payment_state,alert_state,version,pending_payment_count,aging_bucket,promise_date,collection_priority,collection_sort_date",
          { count: "exact" },
        );
  query = applyReceivableFilters(query, parsed.data, context.isAdmin);
  query = context.isAdmin
    ? query.order("next_follow_up_date", { ascending: true, nullsFirst: false })
    : query
        .order("collection_priority", { ascending: true })
        .order("collection_sort_date", { ascending: true })
        .order("receivable_id", { ascending: true });
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error)
    return apiError(
      503,
      "READ_FAILED",
      "Confirmed Payment Collections could not be loaded.",
    );
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((row) => String(row.assigned_to)))];
  const { data: owners } = ids.length
    ? await context.service
        .from("users")
        .select("user_id,name")
        .in("user_id", ids)
    : { data: [] };
  const names = new Map(
    (owners ?? []).map((owner) => [owner.user_id, owner.name]),
  );
  return Response.json({
    rows: rows.map((row) => ({
      ...row,
      owner_name: names.get(String(row.assigned_to)) ?? "Assigned employee",
    })),
    page,
    pageSize,
    total: count ?? 0,
  });
}
