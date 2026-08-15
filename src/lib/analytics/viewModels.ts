import { getISTDateKey } from "@/lib/dateTime";

export interface AnalyticsMetric {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface VisitAnalyticsSource {
  visit_id: string;
  visit_outcome: string;
  segment_type?: string | null;
  check_in_time: string;
}

export interface VisitOutcomeSlice extends AnalyticsMetric {
  share: number;
}

export interface VisitActivityPoint {
  date: string;
  label: string;
  retailer: number;
  distributor: number;
  other: number;
  total: number;
}

export interface VisitAnalyticsModel {
  representedTotal: number;
  outcomes: VisitOutcomeSlice[];
  activity: VisitActivityPoint[];
  fieldMix: AnalyticsMetric[];
}

export interface TeamKpiAnalyticsRow {
  user_id: string;
  name: string;
  calls_made: number;
  queries_handled: number;
  mappings_completed: number;
  tasks_completed: number;
}

export type TeamKpiMetricKey = "calls_made" | "queries_handled" | "mappings_completed" | "tasks_completed";

export const TEAM_KPI_METRICS: ReadonlyArray<{ key: TeamKpiMetricKey; label: string; color: string }> = [
  { key: "calls_made", label: "Calls", color: "var(--viz-info)" },
  { key: "queries_handled", label: "Client queries", color: "var(--viz-success)" },
  { key: "mappings_completed", label: "Mappings", color: "var(--viz-warning)" },
  { key: "tasks_completed", label: "Tasks done", color: "var(--viz-primary)" },
];

const VISIT_OUTCOMES: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: "registered", label: "New registration", color: "var(--viz-primary)" },
  { key: "installed", label: "Installed", color: "var(--viz-success)" },
  { key: "interested", label: "Interested", color: "var(--viz-info)" },
  { key: "follow_up", label: "Follow-up", color: "var(--viz-warning)" },
  { key: "payment_follow_up", label: "Payment follow-up", color: "var(--viz-pending)" },
  { key: "payment_done", label: "Payment done", color: "var(--viz-success-strong)" },
  { key: "not_interested", label: "Not interested", color: "var(--viz-danger)" },
];

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function buildVisitAnalytics(visits: VisitAnalyticsSource[], maxPoints = 31): VisitAnalyticsModel {
  const representedTotal = visits.length;
  const outcomeCounts = new Map<string, number>();
  const daily = new Map<string, VisitActivityPoint>();
  const fieldCounts = { retailer: 0, distributor: 0, other: 0 };

  for (const visit of visits) {
    outcomeCounts.set(visit.visit_outcome, (outcomeCounts.get(visit.visit_outcome) ?? 0) + 1);

    const segment = visit.segment_type?.toLowerCase() ?? "";
    const segmentKey = segment === "retailer" ? "retailer" : segment === "distributor" ? "distributor" : "other";
    fieldCounts[segmentKey] += 1;

    const date = getISTDateKey(visit.check_in_time);
    const point = daily.get(date) ?? {
      date,
      label: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(visit.check_in_time)),
      retailer: 0,
      distributor: 0,
      other: 0,
      total: 0,
    };
    point[segmentKey] += 1;
    point.total += 1;
    daily.set(date, point);
  }

  const knownKeys = new Set(VISIT_OUTCOMES.map((item) => item.key));
  const unknownCount = [...outcomeCounts.entries()].reduce(
    (total, [key, count]) => total + (knownKeys.has(key) ? 0 : count),
    0,
  );
  const outcomes = VISIT_OUTCOMES.map((item) => {
    const value = outcomeCounts.get(item.key) ?? 0;
    return { ...item, value, share: representedTotal ? value / representedTotal : 0 };
  });
  if (unknownCount) {
    outcomes.push({ key: "unknown", label: "Other / historical", value: unknownCount, share: unknownCount / representedTotal, color: "var(--viz-muted)" });
  }

  return {
    representedTotal,
    outcomes,
    activity: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-Math.max(1, Math.min(maxPoints, 31))),
    fieldMix: [
      { key: "retailer", label: "Retailer", value: fieldCounts.retailer, color: "var(--viz-primary)" },
      { key: "distributor", label: "Distributor", value: fieldCounts.distributor, color: "var(--viz-info)" },
      ...(fieldCounts.other ? [{ key: "other", label: "Other / historical", value: fieldCounts.other, color: "var(--viz-muted)" }] : []),
    ],
  };
}

export function getContributionRows(rows: TeamKpiAnalyticsRow[], key: TeamKpiMetricKey) {
  const total = rows.reduce((sum, row) => sum + safeCount(row[key]), 0);
  return {
    total,
    rows: rows.map((row, index) => ({
      key: row.user_id,
      label: row.name,
      value: safeCount(row[key]),
      share: total ? safeCount(row[key]) / total : 0,
      color: `var(--viz-series-${(index % 8) + 1})`,
    })),
  };
}

export function buildRelativeKpiProfile(rows: TeamKpiAnalyticsRow[], selectedUserId: string) {
  const selected = rows.find((row) => row.user_id === selectedUserId) ?? rows[0];
  if (!selected) return [];

  return TEAM_KPI_METRICS.map((metric) => {
    const rawValues = rows.map((row) => safeCount(row[metric.key]));
    const max = Math.max(1, ...rawValues);
    const teamRaw = rows.length ? rawValues.reduce((sum, value) => sum + value, 0) / rows.length : 0;
    const employeeRaw = safeCount(selected[metric.key]);
    return {
      metric: metric.label,
      employee: Math.round((employeeRaw / max) * 100),
      team: Math.round((teamRaw / max) * 100),
      employeeRaw,
      teamRaw,
      max,
    };
  });
}

export function metricTotal(metrics: Array<Pick<AnalyticsMetric, "value">>): number {
  return metrics.reduce((sum, metric) => sum + safeCount(metric.value), 0);
}
