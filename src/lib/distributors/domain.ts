import { isValidISTDateKey } from "@/lib/dateTime";

export const installationStatuses = ["pending", "done"] as const;
export const trainingStatuses = ["pending", "done"] as const;
export const activityStatuses = ["not_applicable", "active", "inactive"] as const;
export const billingStatuses = ["not_billed", "billed"] as const;
export type RenewalState = "renewal_due_in_2_days" | "renewal_due_tomorrow" | "renewal_due_today" | "renewal_overdue" | "renewal_upcoming" | "none";

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

export function validateStatusCombination(input: { installation_status: string; training_status: string; activity_status: string }) {
  if (input.installation_status !== "done" && input.training_status === "done") return "Training cannot be completed before installation.";
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
