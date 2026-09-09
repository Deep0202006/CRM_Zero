import { z } from "zod";
import { addISTDateDays, getISTBusinessDayBounds, getISTDateKey, isValidISTDateKey, IST_TIMEZONE } from "@/lib/dateTime";
import { isGenuineCallLog, type CanonicalCallLog } from "@/lib/workMetrics/canonical";

export const HISTORY_MAX_DAYS = 31;
export const HISTORY_METRICS = {
  calls_made: { label: "Observed retained calls", reason: "Historical coverage is uncertified. Retained records are not proof of all work performed." },
  tasks_completed: { label: "Tasks completed", reason: "Historical assignee and reopen/recompletion coverage are unavailable. Allocated targets are included in Today Tasks, not reconstructed here." },
  mappings_completed: { label: "Mappings completed", reason: "Legacy updated_at is not reliable completion history; historical attribution and coverage are unavailable." },
  queries_handled: { label: "Queries resolved", reason: "Current resolved rows do not establish complete historical resolution/reopen events." },
} as const;
export type HistoryMetric = keyof typeof HISTORY_METRICS;
export type HistoryScope = { from: string; to: string; employee: string | null; days: number; previous_from: string; previous_to: string };
export class HistoryRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export function parseHistoryScope(params: URLSearchParams, now: string): HistoryScope | null {
  if (!["from", "to", "employee"].some((key) => params.has(key))) return null;
  if (["from", "to", "employee"].some((key) => params.getAll(key).length > 1)) throw new HistoryRequestError("INVALID_HISTORY_RANGE", "Use one value per history filter.");
  const from = params.get("from") ?? "", to = params.get("to") ?? "", employee = params.get("employee") || null;
  if (!isValidISTDateKey(from) || !isValidISTDateKey(to) || from > to || to > getISTDateKey(now) || from < "1000-02-01") throw new HistoryRequestError("INVALID_HISTORY_RANGE", "Choose real four-digit calendar dates from 1000-02-01, in order, ending no later than today. This calendar limit is not a coverage claim.");
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > HISTORY_MAX_DAYS) throw new HistoryRequestError("HISTORY_RANGE_TOO_LARGE", "History is limited to 31 days per selection.");
  if (employee && !z.string().uuid().safeParse(employee).success) throw new HistoryRequestError("INVALID_HISTORY_EMPLOYEE", "Choose a valid employee.");
  return { from, to, employee, days, previous_from: addISTDateDays(from, -days), previous_to: addISTDateDays(from, -1) };
}

const nullableCount = z.number().int().nonnegative().nullable();
const daySchema = z.object({ date: z.string().refine(isValidISTDateKey), retained_calls: nullableCount, value: nullableCount });
const employeeSchema = z.object({ user_id: z.string().uuid(), name: z.string(), role: z.string(), retained_calls: nullableCount, previous_retained_calls: nullableCount, latest_activity_time: z.string().datetime().nullable() });
export const historyReportSchema = z.object({
  kind: z.literal("team-history-v1"), generated_at: z.string().datetime(),
  scope: z.object({ from: z.string(), to: z.string(), employee: z.string().uuid().nullable(), days: z.number().int().min(1).max(31), previous_from: z.string(), previous_to: z.string() }),
  cohort: z.object({ definition: z.literal("current-roster"), count: z.number().int().min(1).max(200), members: z.array(z.string().uuid()).max(200) }),
  coverage: z.object({ historical: z.literal("uncertified"), source_read: z.enum(["complete", "unavailable"]), reason: z.string(), partial_today: z.boolean(), requests: z.number().int().min(0).max(24) }),
  totals: z.object({ retained_calls: nullableCount, complete_calls: z.null() }),
  metrics: z.object({ calls_made: z.literal("retained-observations-only"), tasks_completed: z.literal("unavailable"), mappings_completed: z.literal("unavailable"), queries_handled: z.literal("unavailable"), unique_completed_work: z.literal("unavailable"), followup_calls: z.literal("unavailable") }),
  daily: z.array(daySchema).max(31), previous_daily: z.array(daySchema).max(31), employees: z.array(employeeSchema).max(200),
  comparison: z.object({ available: z.literal(false), reason: z.string(), absolute_change: z.null(), percent_change: z.null() }),
}).superRefine((report, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "History scope, cohort or retained counts do not reconcile." });
  const { scope, employees, cohort } = report;
  if (cohort.count !== employees.length || new Set(cohort.members).size !== cohort.count || employees.some((row) => !cohort.members.includes(row.user_id)) || new Set(employees.map((row) => row.user_id)).size !== employees.length || (scope.employee && !cohort.members.includes(scope.employee))) fail();
  try {
    const parsed = parseHistoryScope(new URLSearchParams({ from: scope.from, to: scope.to, ...(scope.employee ? { employee: scope.employee } : {}) }), report.generated_at);
    if (!parsed || (Object.keys(scope) as Array<keyof HistoryScope>).some((key) => parsed[key] !== scope[key])) { fail(); return; }
  } catch { fail(); return; }
  for (const [points, first] of [[report.daily, scope.from], [report.previous_daily, scope.previous_from]] as const) {
    if (points.length !== scope.days || points.some((point, index) => point.date !== addISTDateDays(first, index) || point.value !== (point.retained_calls || null))) fail();
  }
  const selected = employees.filter((row) => !scope.employee || row.user_id === scope.employee);
  if (report.coverage.source_read === "complete") {
    if (employees.some((row) => row.retained_calls === null || row.previous_retained_calls === null) || [...report.daily, ...report.previous_daily].some((point) => point.retained_calls === null)) fail();
    if (report.totals.retained_calls !== selected.reduce((sum, row) => sum + (row.retained_calls ?? 0), 0) || report.totals.retained_calls !== report.daily.reduce((sum, point) => sum + (point.retained_calls ?? 0), 0) || selected.reduce((sum, row) => sum + (row.previous_retained_calls ?? 0), 0) !== report.previous_daily.reduce((sum, point) => sum + (point.retained_calls ?? 0), 0)) fail();
  } else if (report.totals.retained_calls !== null || employees.some((row) => row.retained_calls !== null || row.previous_retained_calls !== null || row.latest_activity_time !== null) || [...report.daily, ...report.previous_daily].some((point) => point.retained_calls !== null)) fail();
});
export type HistoryReport = z.infer<typeof historyReportSchema>;

export function buildHistoryReport({ scope, generatedAt, members, calls, requests, sourceError = null }: {
  scope: HistoryScope; generatedAt: string; members: Array<{ user_id: string; name: string; role: string }>;
  calls: CanonicalCallLog[]; requests: number; sourceError?: string | null;
}): HistoryReport {
  const ids = new Set(members.map((row) => row.user_id));
  const start = getISTBusinessDayBounds(scope.previous_from).startsAt;
  const end = [getISTBusinessDayBounds(scope.to).endsAt, generatedAt].sort()[0];
  const unique = [...new Map(calls.filter((call) => call.user_id && ids.has(call.user_id) && isGenuineCallLog(call) && !Number.isNaN(Date.parse(call.timestamp)) && Date.parse(call.timestamp) >= Date.parse(start) && Date.parse(call.timestamp) < Date.parse(end)).map((call) => [call.log_id, call])).values()];
  const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const dated = unique.map((call) => ({ ...call, timestamp: new Date(call.timestamp).toISOString(), date: dateFormatter.format(new Date(call.timestamp)) }));
  const count = (rows: unknown[]) => sourceError ? null : rows.length;
  const selected = dated.filter((call) => !scope.employee || call.user_id === scope.employee);
  const daily = (first: string) => Array.from({ length: scope.days }, (_, index) => { const date = addISTDateDays(first, index), retained_calls = count(selected.filter((call) => call.date === date)); return { date, retained_calls, value: retained_calls || null }; });
  const partial = scope.to === getISTDateKey(generatedAt);
  return historyReportSchema.parse({
    kind: "team-history-v1", generated_at: generatedAt, scope,
    cohort: { definition: "current-roster", count: members.length, members: members.map((row) => row.user_id) },
    coverage: { historical: "uncertified", source_read: sourceError ? "unavailable" : "complete", reason: sourceError ?? "No authoritative historical coverage watermark. Counts describe retained confirmed records only; empty days do not establish zero work.", partial_today: partial, requests },
    totals: { retained_calls: count(selected.filter((call) => call.date >= scope.from)), complete_calls: null },
    metrics: { calls_made: "retained-observations-only", tasks_completed: "unavailable", mappings_completed: "unavailable", queries_handled: "unavailable", unique_completed_work: "unavailable", followup_calls: "unavailable" },
    daily: daily(scope.from), previous_daily: daily(scope.previous_from),
    employees: members.map((member) => { const current = dated.filter((call) => call.user_id === member.user_id && call.date >= scope.from); return { ...member, retained_calls: count(current), previous_retained_calls: count(dated.filter((call) => call.user_id === member.user_id && call.date < scope.from)), latest_activity_time: sourceError ? null : current.map((call) => call.timestamp).sort().at(-1) ?? null }; }),
    comparison: { available: false, reason: sourceError ? "SOURCE_UNAVAILABLE" : partial ? "PARTIAL_CURRENT_DAY_AND_UNCERTIFIED_COVERAGE" : "HISTORY_COVERAGE_UNCERTIFIED", absolute_change: null, percent_change: null },
  });
}
