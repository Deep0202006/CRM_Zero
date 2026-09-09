/** @jest-environment node */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildHistoryReport, historyReportSchema, parseHistoryScope } from "../teamKpi/history";
import { HISTORY_BUDGET, loadTeamKpiHistory } from "../teamKpi/historyServer";

const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
const now = "2026-09-09T06:00:00.000Z";
const scope = (extra = "") => parseHistoryScope(new URLSearchParams(`from=2026-09-07&to=2026-09-08${extra}`), now)!;
const members = [{ user_id: a, name: "A", role: "Administrator" }, { user_id: b, name: "B", role: "Support" }];
const call = (log_id: string, timestamp: string, user_id = a, outcome = "Contacted") => ({ log_id, timestamp, user_id, outcome });
const build = (calls: ReturnType<typeof call>[] = [], extra = "", sourceError?: string) => buildHistoryReport({ scope: scope(extra), generatedAt: now, members, calls, requests: 4, sourceError });

describe("bounded Team history contract", () => {
  it("handles the bounded retained-record ceiling without per-record formatter construction", () => {
    const formatter = jest.spyOn(Intl, "DateTimeFormat");
    try {
      build([call("small", "2026-09-07T00:00:00Z")]);
      const baseline = formatter.mock.calls.length;
      formatter.mockClear();
      const started = performance.now();
      const result = build(Array.from({ length: 19999 }, (_, index) => call(String(index), "2026-09-07T00:00:00Z")));
      expect(result.totals.retained_calls).toBe(19999);
      expect(formatter.mock.calls.length).toBe(baseline);
      console.info(`History 19999-record bounded fixture: ${Math.round(performance.now() - started)}ms; ${formatter.mock.calls.length} formatters`);
    } finally { formatter.mockRestore(); }
  });
  it("preserves the no-filter Today path and validates real IST ranges and employee identifiers", () => {
    expect(parseHistoryScope(new URLSearchParams(), now)).toBeNull();
    for (const query of ["from=2026-02-30&to=2026-03-01", "from=2026-09-08", "from=2026-09-09&to=2026-09-08", "from=2026-09-09&to=2026-09-10", "from=2026-08-01&to=2026-09-01", "from=0099-01-01&to=0099-01-02", "from=2026-09-07&to=2026-09-08&employee=bad", "from=2026-09-07&from=2026-09-06&to=2026-09-08"]) expect(() => parseHistoryScope(new URLSearchParams(query), now)).toThrow();
    expect(scope()).toMatchObject({ days: 2, previous_from: "2026-09-05", previous_to: "2026-09-06" });
    expect(parseHistoryScope(new URLSearchParams("from=2026-08-09&to=2026-09-08"), now)?.days).toBe(31);
  });
  it("uses half-open IST intervals, canonical genuine calls and log identity deduplication", () => {
    const first = call("first", "2026-09-06T18:30:00+00:00");
    const result = build([call("before", "2026-09-04T18:29:59.999Z"), call("prior", "2026-09-06T18:29:59.999Z"), first, first, call("last", "2026-09-08T18:29:59.999Z", b), call("after", "2026-09-08T18:30:00Z"), call("audit", "2026-09-07T00:00:00Z", a, "[Call outcome] → Contacted"), call("foreign", "2026-09-07T00:00:00Z", "outside")]);
    expect(result.totals.retained_calls).toBe(2);
    expect(result.daily.map((row) => row.retained_calls)).toEqual([1, 1]);
    expect(result.previous_daily.map((row) => row.retained_calls)).toEqual([0, 1]);
    expect(result.employees[0].latest_activity_time).toBe("2026-09-06T18:30:00.000Z");
    expect(result.employees.map((row) => row.retained_calls)).toEqual([1, 1]);
  });
  it("keeps the full reference cohort stable under employee selection", () => {
    const calls = [call("a", "2026-09-07T00:00:00Z"), call("b", "2026-09-07T00:00:00Z", b)];
    const all = build(calls), selected = build(calls, `&employee=${a}`);
    expect(selected.cohort).toEqual(all.cohort);
    expect(selected.employees).toEqual(all.employees);
    expect(selected.totals.retained_calls).toBe(1);
  });
  it("does not turn missing coverage or prior zero into complete totals or percentage claims", () => {
    const result = build([call("a", "2026-09-07T00:00:00Z")]);
    expect(result.daily[1]).toEqual({ date: "2026-09-08", retained_calls: 0, value: null });
    expect(result.totals.complete_calls).toBeNull();
    expect(result.comparison).toEqual({ available: false, reason: "HISTORY_COVERAGE_UNCERTIFIED", absolute_change: null, percent_change: null });
    expect(result.employees[0].previous_retained_calls).toBe(0);
  });
  it("withholds elapsed-day comparisons and ignores future observations", () => {
    const result = buildHistoryReport({ scope: parseHistoryScope(new URLSearchParams("from=2026-09-09&to=2026-09-09"), now)!, generatedAt: now, members, requests: 4, calls: [call("elapsed", "2026-09-09T05:59:59Z"), call("future", now)] });
    expect(result.totals.retained_calls).toBe(1);
    expect(result.coverage.partial_today).toBe(true);
    expect(result.comparison.reason).toBe("PARTIAL_CURRENT_DAY_AND_UNCERTIFIED_COVERAGE");
  });
  it("discards incomplete reads and rejects chart/register/scope inconsistencies", () => {
    const missing = build([call("a", "2026-09-07T00:00:00Z")], "", "source failed");
    expect(missing.totals.retained_calls).toBeNull();
    expect(missing.daily.every((row) => row.value === null && row.retained_calls === null)).toBe(true);
    const result = build();
    expect(historyReportSchema.safeParse({ ...result, totals: { ...result.totals, retained_calls: 1 } }).success).toBe(false);
    expect(historyReportSchema.safeParse({ ...result, scope: { ...result.scope, from: "invalid" } }).success).toBe(false);
  });
});

type Result = { data: unknown[] | null; count?: number | null; error?: unknown };
function reader(overrides: Record<string, Result[]> = {}) {
  const operations: Array<[string, string, ...unknown[]]> = [];
  const queues: Record<string, Result[]> = { users: [{ data: members.map((member) => ({ ...member, is_active: true })), count: 2 }], user_capabilities: [{ data: [], count: 0 }], call_logs: [{ data: [] }], ...overrides };
  const from = jest.fn((table: string) => {
    const result = queues[table]?.shift() ?? { data: null, error: "unexpected read" };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "gte", "lt", "range"]) chain[method] = (...args: unknown[]) => { operations.push([table, method, ...args]); return chain; };
    chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(resolve({ error: null, ...result }));
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, operations, from };
}
describe("bounded authorized History readers", () => {
  it("constrains calls to the full cohort and one combined interval without an empty capability IN", async () => {
    const mock = reader();
    const result = await loadTeamKpiHistory(mock.client, scope(`&employee=${a}`), now);
    expect(mock.from.mock.calls.map(([table]) => table)).toEqual(["users", "user_capabilities", "call_logs"]);
    expect(mock.operations).toContainEqual(["call_logs", "in", "user_id", [a, b]]);
    expect(mock.operations).toContainEqual(["call_logs", "gte", "timestamp", "2026-09-04T18:30:00.000Z"]);
    expect(mock.operations).toContainEqual(["call_logs", "lt", "timestamp", "2026-09-08T18:30:00.000Z"]);
    expect(result.coverage.requests).toBe(3);
  });
  it("rejects out-of-cohort selection before reading calls and fails closed on truncated directory", async () => {
    const external = reader({ user_capabilities: [{ data: [{ user_id: b, capability_code: "erp_partner_viewer" }], count: 1 }] });
    await expect(loadTeamKpiHistory(external.client, scope(`&employee=${b}`), now)).rejects.toMatchObject({ status: 404 });
    expect(external.from).not.toHaveBeenCalledWith("call_logs");
    const truncated = reader({ users: [{ data: [], count: 201 }] });
    await expect(loadTeamKpiHistory(truncated.client, scope(), now)).rejects.toMatchObject({ code: "HISTORY_COHORT_UNAVAILABLE" });
  });
  it("bounds pagination and never emits a partial count after source failure or budget exhaustion", async () => {
    const fullPage = Array.from({ length: HISTORY_BUDGET.pageSize }, (_, i) => call(String(i), "2026-09-07T00:00:00Z"));
    for (const pages of [[{ data: fullPage }, { data: null, error: "failed" }], Array.from({ length: HISTORY_BUDGET.callPages }, () => ({ data: fullPage }))]) {
      const mock = reader({ call_logs: [...pages] });
      const result = await loadTeamKpiHistory(mock.client, scope(), now);
      expect(result.coverage.source_read).toBe("unavailable");
      expect(result.totals.retained_calls).toBeNull();
      expect(result.coverage.requests).toBeLessThanOrEqual(HISTORY_BUDGET.requests);
      expect(mock.from.mock.calls.filter(([table]) => table === "call_logs")).toHaveLength(pages.length);
    }
  });
});
