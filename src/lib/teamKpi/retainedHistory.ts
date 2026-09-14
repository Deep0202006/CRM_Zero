import { z } from "zod";
import { addISTDateDays, getISTDateKey } from "@/lib/dateTime";
import { visitUuid } from "@/lib/fieldVisits/range";
import type { HistoryScope } from "./history";

export const retainedMetricSchema = z.enum(["calls_made", "visits", "mappings_completed"]);
export type RetainedMetric = z.infer<typeof retainedMetricSchema>;
export const RETAINED_METRICS = {
  calls_made: { label: "Retained genuine Calls", meaning: "Immutable call author and timestamp; canonical synthetic audits excluded. Not reached calls or all work." },
  visits: { label: "Retained confirmed Visits", meaning: "Immutable Visit author and canonical stored Visit date. Not check-in-date OR buckets or all field activity." },
  mappings_completed: { label: "Current Mapping completion snapshot", meaning: "Currently Completed requests by stored completer/date. Reopening removes prior buckets; recompletion records a new actor/time. Not permanent event credit." },
} as const;
export type RetainedEvent = { id: string; user_id: string; date: string; timestamp: string };
const count = z.number().int().min(0).max(20000).nullable();
const comparisonSchema = z.object({
  kind: z.literal("retained-record-count-change"), available: z.boolean(), reason: z.string().nullable(),
  absolute_change: z.number().int().min(-20000).max(20000).nullable(), percent_change: z.number().finite().nullable(),
});
export function retainedComparison(current: number | null, previous: number | null, reason: string | null) {
  const available = !reason && current !== null && previous !== null;
  return { kind: "retained-record-count-change" as const, available, reason: available ? null : reason ?? "SOURCE_UNAVAILABLE",
    absolute_change: available ? current! - previous! : null,
    percent_change: available && previous! > 0 ? (current! - previous!) / previous! * 100 : null };
}
export const retainedHistorySchema = z.object({
  metric: retainedMetricSchema, source_read: z.enum(["exhausted", "unavailable"]),
  consistency: z.literal("bounded-live-multi-request"), historical_coverage: z.literal("uncertified"),
  current: count, previous: count,
  daily: z.array(count).max(31), previous_daily: z.array(count).max(31),
  comparison: comparisonSchema,
  employees: z.array(z.object({ user_id: visitUuid, current: count, previous: count,
    daily: z.array(count).max(31), previous_daily: z.array(count).max(31), comparison: comparisonSchema })).max(200),
});
export type RetainedHistory = z.infer<typeof retainedHistorySchema>;
export function retainedChangeLabel(comparison: RetainedHistory["comparison"], previous: number | null) {
  if (!comparison.available) return comparison.reason === "PARTIAL_CURRENT_DAY" ? "Unavailable · today is partial"
    : comparison.reason === "MUTABLE_COMPLETION_SNAPSHOT" ? "Unavailable · mutable completion snapshot" : "Unavailable · source not exhausted";
  const absolute = comparison.absolute_change!;
  return `${absolute > 0 ? "+" : ""}${absolute.toLocaleString("en-IN")} records${previous === 0 ? " · prior zero; percentage unavailable" : ` · ${comparison.percent_change!.toLocaleString("en-IN", { maximumFractionDigits: 2 })}% retained-count change`}`;
}

export function buildRetainedHistory({ scope, generatedAt, members, events, sourceError }: {
  scope: HistoryScope; generatedAt: string; members: Array<{ user_id: string }>;
  events: RetainedEvent[]; sourceError: string | null;
}): RetainedHistory {
  const metric = scope.metric ?? "calls_made", mapping = metric === "mappings_completed";
  const dates = new Map(Array.from({ length: scope.days * 2 }, (_, index) => [addISTDateDays(scope.previous_from, index), index]));
  const matrix = new Map(members.map(member => [member.user_id, Array<number>(scope.days * 2).fill(0)]));
  const seen = new Set<string>();
  // One pass over the selected source; no employee/day reads or repeated event scans.
  for (const event of events) {
    const cells = matrix.get(event.user_id), index = dates.get(event.date);
    if (!cells || index === undefined || seen.has(event.id)) continue;
    seen.add(event.id); cells[index]++;
  }
  const reason = sourceError ? "SOURCE_UNAVAILABLE" : mapping ? "MUTABLE_COMPLETION_SNAPSHOT" : scope.to === getISTDateKey(generatedAt) ? "PARTIAL_CURRENT_DAY" : null;
  const daily = Array<number | null>(scope.days).fill(sourceError ? null : 0);
  const previous_daily = Array<number | null>(scope.days).fill(sourceError || mapping ? null : 0);
  const sum = (cells: Array<number | null>) => cells.some(value => value === null) ? null : cells.reduce<number>((total, value) => total + value!, 0);
  const employees = members.map(member => {
    const cells = matrix.get(member.user_id)!;
    const currentCells = cells.slice(scope.days).map(value => sourceError ? null : value);
    const previousCells = cells.slice(0, scope.days).map(value => sourceError || mapping ? null : value);
    if (!scope.employee || member.user_id === scope.employee) {
      for (let i = 0; i < scope.days; i++) {
        if (daily[i] !== null) daily[i]! += currentCells[i]!;
        if (previous_daily[i] !== null) previous_daily[i]! += previousCells[i]!;
      }
    }
    const current = sum(currentCells), previous = sum(previousCells);
    return { user_id: member.user_id, current, previous, daily: currentCells, previous_daily: previousCells, comparison: retainedComparison(current, previous, reason) };
  });
  const current = sum(daily), previous = sum(previous_daily);
  return retainedHistorySchema.parse({ metric, source_read: sourceError ? "unavailable" : "exhausted", consistency: "bounded-live-multi-request", historical_coverage: "uncertified",
    current, previous, daily, previous_daily, employees, comparison: retainedComparison(current, previous, reason) });
}

export function retainedHistoryReconciles(report: RetainedHistory, scope: HistoryScope, generatedAt: string, memberIds: string[]) {
  if (report.metric !== (scope.metric ?? "calls_made") || report.employees.length !== memberIds.length
    || new Set(report.employees.map(row => row.user_id)).size !== memberIds.length || report.employees.some(row => !memberIds.includes(row.user_id))) return false;
  const unavailable = report.source_read === "unavailable", mapping = report.metric === "mappings_completed";
  const reason = unavailable ? "SOURCE_UNAVAILABLE" : mapping ? "MUTABLE_COMPLETION_SNAPSHOT" : scope.to === getISTDateKey(generatedAt) ? "PARTIAL_CURRENT_DAY" : null;
  const groups = [report, ...report.employees];
  for (const row of groups) {
    for (const [cells, total, missing] of [[row.daily, row.current, unavailable], [row.previous_daily, row.previous, unavailable || mapping]] as const) {
      if (cells.length !== scope.days || (missing ? total !== null || cells.some(value => value !== null)
        : total === null || cells.some(value => value === null) || cells.reduce<number>((sum, value) => sum + value!, 0) !== total)) return false;
    }
    if (JSON.stringify(row.comparison) !== JSON.stringify(retainedComparison(row.current, row.previous, reason))) return false;
  }
  const selected = report.employees.filter(row => !scope.employee || row.user_id === scope.employee);
  for (let i = 0; i < scope.days; i++) {
    if (!unavailable && report.daily[i] !== selected.reduce((sum, row) => sum + row.daily[i]!, 0)) return false;
    if (!unavailable && !mapping && report.previous_daily[i] !== selected.reduce((sum, row) => sum + row.previous_daily[i]!, 0)) return false;
  }
  return true;
}
