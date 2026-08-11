export type LifecycleStatus = "active" | "disputed" | "cancelled";
export type PaymentState = "Unpaid" | "Partially Paid" | "Paid" | "Disputed" | "Cancelled";
export type AlertState = "payment_verification_pending" | "promise_overdue" | "followup_overdue" | "promise_due_today" | "followup_due_today" | "upcoming" | "disputed" | "none";

const MONEY = /^(\d{1,12})(?:\.(\d{1,2}))?$/;
export function parseMoneyToMinorUnits(input: string | number): bigint {
  const normalized = String(input).trim().replace(/^₹\s?/, "").replace(/,/g, "");
  const match = MONEY.exec(normalized);
  if (!match) throw new Error("Enter a positive amount with no more than two decimals.");
  const units = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (units <= BigInt(0) || units > BigInt("99999999999999")) throw new Error("Amount is outside the supported range.");
  return units;
}
export function minorUnitsToDecimal(value: bigint): string { return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`; }
export function canonicalMoney(input: string | number): string { return minorUnitsToDecimal(parseMoneyToMinorUnits(input)); }
export function formatInr(decimal: string): string {
  const [whole, fraction = "00"] = decimal.split(".");
  const tail=whole.slice(-3), head=whole.slice(0,-3).replace(/\B(?=(\d{2})+(?!\d))/g,",");
  return `₹${head ? `${head},` : ""}${tail}${fraction !== "00" ? `.${fraction}` : ""}`;
}
export function derivePaymentState(lifecycle: LifecycleStatus, bill: bigint, confirmed: bigint): PaymentState {
  if (lifecycle === "cancelled") return "Cancelled"; if (lifecycle === "disputed") return "Disputed";
  if (bill <= BigInt(0) || confirmed < BigInt(0) || confirmed > bill) throw new Error("Invalid authoritative balance.");
  return confirmed === BigInt(0) ? "Unpaid" : confirmed === bill ? "Paid" : "Partially Paid";
}
export function deriveAlertState(input: { lifecycleStatus: LifecycleStatus; outstandingMinor: bigint; paymentVerificationPending: boolean; today: string; nextFollowUpDate: string | null; promiseDate: string | null }): AlertState {
  if (input.lifecycleStatus === "cancelled" || input.outstandingMinor === BigInt(0)) return "none";
  if (input.lifecycleStatus === "disputed") return "disputed";
  if (input.paymentVerificationPending) return "payment_verification_pending";
  const date = input.promiseDate ?? input.nextFollowUpDate; if (!date) return "none";
  const promise = Boolean(input.promiseDate); if (date < input.today) return promise ? "promise_overdue" : "followup_overdue";
  if (date === input.today) return promise ? "promise_due_today" : "followup_due_today";
  return "upcoming";
}
