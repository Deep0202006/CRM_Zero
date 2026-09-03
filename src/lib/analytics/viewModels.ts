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
  followup_calls?: number;
  queries_handled: number;
  mappings_completed: number;
  tasks_completed: number;
  total_completed_work?: number;
}

export type TeamKpiMetricKey = "total_completed_work" | "calls_made" | "followup_calls" | "queries_handled" | "mappings_completed" | "tasks_completed";

export const TEAM_KPI_METRICS: ReadonlyArray<{ key: TeamKpiMetricKey; label: string; color: string }> = [
  { key: "total_completed_work", label: "Unique completed work", color: "var(--viz-primary)" },
  { key: "calls_made", label: "Calls", color: "var(--viz-info)" },
  { key: "followup_calls", label: "Follow-up calls", color: "var(--viz-pending)" },
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

function safeCount(value: number | undefined): number {
  return value != null && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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

export function buildEmployeeTeamComparison(rows: TeamKpiAnalyticsRow[], selectedUserId: string) {
  const selected = rows.find((row) => row.user_id === selectedUserId) ?? rows[0];
  if (!selected) return [];

  return TEAM_KPI_METRICS.map((metric) => {
    const rawValues = rows.map((row) => safeCount(row[metric.key]));
    const teamRaw = rows.length ? rawValues.reduce((sum, value) => sum + value, 0) / rows.length : 0;
    const employeeRaw = safeCount(selected[metric.key]);
    return {
      metric: metric.label,
      employeeRaw,
      teamRaw,
    };
  });
}

export function partitionReconciles(metrics: Array<Pick<AnalyticsMetric, "value">>, total: number): boolean {
  return total >= 0 && metricTotal(metrics) === total;
}

export function buildRenewalUrgency(metrics: { overdue: number; today: number; tomorrow: number; in_two_days: number }): AnalyticsMetric[] {
  return [
    { key: "overdue", label: "Overdue", value: safeCount(metrics.overdue), color: "var(--viz-danger)" },
    { key: "today", label: "Today", value: safeCount(metrics.today), color: "var(--viz-warning)" },
    { key: "tomorrow", label: "Tomorrow", value: safeCount(metrics.tomorrow), color: "var(--viz-info)" },
    { key: "in_two_days", label: "In two days", value: safeCount(metrics.in_two_days), color: "var(--viz-primary)" },
  ];
}

export function buildDistributorMilestones(metrics: { installation_training_done: number; mapped: number; billed: number }): AnalyticsMetric[] {
  return [
    { key: "installation_training_done", label: "Installation + training done", value: safeCount(metrics.installation_training_done), color: "var(--viz-primary)" },
    { key: "mapped", label: "Mapped", value: safeCount(metrics.mapped), color: "var(--viz-info)" },
    { key: "billed", label: "Billed", value: safeCount(metrics.billed), color: "var(--viz-success)" },
  ];
}

export function buildCallReachComposition(total: number, reached: number): AnalyticsMetric[] | null {
  if (!Number.isInteger(total) || !Number.isInteger(reached) || total < 0 || reached < 0 || reached > total) return null;
  return [
    { key: "reached", label: "Reached", value: reached, color: "var(--viz-success)" },
    { key: "no_response", label: "No response", value: total - reached, color: "var(--viz-warning)" },
  ];
}

export function buildErpCoverageRows(segments: Record<string, { coverage_percent: number } | undefined>) {
  return (["Retailer", "Distributor"] as const).map((label) => ({
    key: label.toLowerCase(),
    label,
    value: Math.max(0, Math.min(100, Number(segments[label]?.coverage_percent) || 0)),
  }));
}

export function metricTotal(metrics: Array<Pick<AnalyticsMetric, "value">>): number {
  return metrics.reduce((sum, metric) => sum + safeCount(metric.value), 0);
}
