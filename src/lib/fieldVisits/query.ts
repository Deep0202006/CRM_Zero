import { addISTDateDays, getCurrentISTDate } from "@/lib/dateTime";
import { getOutcomeLabel } from "./contract";

export function adminVisitOutcomeLabel(outcome: string) {
  if (outcome === "registered") return "New Registration";
  const label = getOutcomeLabel(outcome);
  if (label !== outcome) return label;
  const words = outcome.trim().replace(/[_-]+/g, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "Unknown outcome";
}

export type VisitQuery = { date: string; dateFrom: string; dateTo: string; search: string; representative: string; segment: string; outcome: string };
export function initialVisitQuery(): VisitQuery {
  const today = getCurrentISTDate();
  return { date: "", dateFrom: addISTDateDays(today, -6), dateTo: today, search: "", representative: "ALL", segment: "ALL", outcome: "ALL" };
}
export function visitQueryParams(query: VisitQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.date) params.set("date", query.date);
  else {
    if (query.dateFrom) params.set("date_from", query.dateFrom);
    if (query.dateTo) params.set("date_to", query.dateTo);
  }
  if (query.search.trim()) params.set("search", query.search.trim());
  for (const key of ["representative", "segment", "outcome"] as const) if (query[key] !== "ALL") params.set(key, query[key]);
  return params;
}
export const visitQueryKey = (query: VisitQuery) => visitQueryParams(query).toString();
