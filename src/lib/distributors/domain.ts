import { isValidISTDateKey } from "@/lib/dateTime";

export const installationStatuses = ["pending", "done"] as const;
export const trainingStatuses = ["pending", "done"] as const;
export const mappingStatuses = ["pending", "done"] as const;
export const activityStatuses = ["not_applicable", "active", "inactive"] as const;
export const billingStatuses = ["not_billed", "billed"] as const;
export type RenewalState = "renewal_due_in_2_days" | "renewal_due_tomorrow" | "renewal_due_today" | "renewal_overdue" | "renewal_upcoming" | "none";

const PROJECTION_MONEY = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

export function normalizeProjectionMoney(input: string | number): string {
  if (typeof input === "number" && !Number.isFinite(input)) throw new Error("Invalid financial projection value.");
  if (typeof input !== "string" && typeof input !== "number") throw new Error("Invalid financial projection value.");
  const match = PROJECTION_MONEY.exec(String(input).trim());
  if (!match) throw new Error("Invalid financial projection value.");
  const whole = match[1].replace(/^0+(?=\d)/, "");
  return `${whole}.${(match[2] ?? "").padEnd(2, "0")}`;
}

export function normalizeDistributorFinancialProjectionRow(row: Record<string, unknown>) {
  return {
    ...row,
    total_bill_amount: normalizeProjectionMoney(row.total_bill_amount as string | number),
    confirmed_collected_amount: normalizeProjectionMoney(row.confirmed_collected_amount as string | number),
    outstanding_amount: normalizeProjectionMoney(row.outstanding_amount as string | number),
  };
}

function utcDateValue(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function renewalState(renewalDate: string | null, today: string): RenewalState {
  if (!renewalDate || !isValidISTDateKey(renewalDate) || !isValidISTDateKey(today)) return "none";
  const days = Math.round((utcDateValue(renewalDate) - utcDateValue(today)) / 86_400_000);
  if (days < 0) return "renewal_overdue";
  if (days === 0) return "renewal_due_today";
  if (days === 1) return "renewal_due_tomorrow";
  if (days === 2) return "renewal_due_in_2_days";
  return "renewal_upcoming";
}

export function validateStatusCombination(input: { installation_status: string; training_status: string; mapping_status?: string | null; mapped_at?: string | null; activity_status: string }) {
  if (input.installation_status !== "done" && input.training_status === "done") return "Training cannot be completed before installation.";
  if (input.mapping_status === "done" && (input.installation_status !== "done" || input.training_status !== "done")) return "Mapping cannot be completed before installation and training.";
  if (input.mapping_status !== "done" && input.mapped_at) return "Mapped Date requires Mapping Status done.";
  if ((input.installation_status !== "done" || input.training_status !== "done") && input.activity_status !== "not_applicable") return "Activity must remain not applicable until installation and training are complete.";
  return null;
}

export function normalizedIdentity(name: string, reference?: string | null) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
  return reference?.trim() ? `code:${normalize(reference)}` : `name:${normalize(name)}`;
}

export function renewalLabel(state: RenewalState) {
  return ({renewal_due_in_2_days:"Renewal in 2 days",renewal_due_tomorrow:"Renewal tomorrow",renewal_due_today:"Renewal today",renewal_overdue:"Renewal overdue",renewal_upcoming:"Upcoming",none:"No renewal date"} as const)[state];
}
