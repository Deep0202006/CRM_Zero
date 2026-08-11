import type { ReceivablesFilters } from "./validation";

export function sanitizeReceivablesSearch(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}\s\-/]/gu, " ").replace(/\s+/g, " ").trim();
}

// Supabase's fluent builder type is intentionally preserved across arbitrary filter stages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyReceivableFilters(query:any,filters:ReceivablesFilters,isAdmin:boolean){
 let result=query;if(filters.search){const safe=sanitizeReceivablesSearch(filters.search);if(safe)result=result.or(`bill_reference.ilike.%${safe}%,distributor_name.ilike.%${safe}%`)}if(filters.owner&&isAdmin)result=result.eq("assigned_to",filters.owner);if(filters.paymentState)result=result.eq("payment_state",filters.paymentState);if(filters.alertState)result=result.eq("alert_state",filters.alertState);if(filters.aging)result=result.eq("aging_bucket",filters.aging);if(filters.billDueFrom)result=result.gte("bill_due_date",filters.billDueFrom);if(filters.billDueTo)result=result.lte("bill_due_date",filters.billDueTo);if(filters.followUpFrom)result=result.gte("next_follow_up_date",filters.followUpFrom);if(filters.followUpTo)result=result.lte("next_follow_up_date",filters.followUpTo);return result;
}
