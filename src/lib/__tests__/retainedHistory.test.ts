/** @jest-environment node */
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { GET as teamGET } from "@/app/api/team-kpi/route";
import { GET as selfGET } from "@/app/api/my-day/history/route";
import { createServerAnonClient, createServerServiceClient } from "../serverBackendEnvironment";
import { buildHistoryReport, historyReportSchema, parseHistoryScope } from "../teamKpi/history";
import { historyTimestamp, readRetainedHistory } from "../teamKpi/retainedHistoryServer";
import { createReportResource } from "../analytics/reportResource";

jest.mock("../serverBackendEnvironment", () => ({ createServerAnonClient: jest.fn(), createServerServiceClient: jest.fn(), backendUnavailableResponse: () => Response.json({}, { status: 503 }) }));
const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
const now = "2026-09-09T06:00:00.000Z", query = "from=2026-09-07&to=2026-09-08";
const members = [{ user_id: a, name: "A", role: "Field" }, { user_id: b, name: "B", role: "Support" }];
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const call = (n: number, user_id = a, timestamp = "2026-09-07T04:00:00Z", outcome = "Connected") => ({ log_id: id(n), user_id, timestamp, outcome });
const request = (suffix = query) => new NextRequest(`https://fixture.invalid/api?${suffix}`, { headers: { Authorization: "Bearer synthetic" } });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

function transport(pages: Record<string, unknown[][]>, { active = true, admin = true } = {}) {
  const seen: URL[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = new URL(String(input)); seen.push(url);
    if (url.pathname.endsWith("/auth/v1/user")) return Response.json({ id: a });
    if (url.pathname.endsWith("/users")) return url.searchParams.has("user_id")
      ? Response.json([{ user_id: a, name: "A", is_active: active }])
      : Response.json(members.map(member => ({ ...member, is_active: true })), { headers: { "Content-Range": "0-1/2" } });
    if (url.pathname.endsWith("/user_capabilities")) return Response.json(url.searchParams.has("capability_code") && admin ? [{ capability_code: "admin" }] : [], { headers: { "Content-Range": "*/0" } });
    const table = url.pathname.split("/").at(-1)!;
    if (pages[table]?.length) return Response.json(pages[table].shift());
    throw Error(`Unexpected source request: ${table}`);
  });
  const backend = (options?: { fetch?: typeof fetch }) => ({ ok: true as const, client: createClient("https://fixture.invalid", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: options?.fetch } }) });
  jest.mocked(createServerServiceClient).mockImplementation(backend);
  jest.mocked(createServerAnonClient).mockImplementation(() => backend());
  return seen;
}

it("separates retained-count change from legacy complete-work claims, zero baseline and partial today", () => {
  const scope = parseHistoryScope(new URLSearchParams(query), now)!;
  const build = (extra = {}) => buildHistoryReport({ scope, generatedAt: now, members, calls: [call(1), call(2, b)], requests: 5, ...extra });
  const report = build();
  expect(report.comparison).toMatchObject({ available: false, absolute_change: null, percent_change: null });
  expect(report.retained_record_history.comparison).toMatchObject({ kind: "retained-record-count-change", available: true, absolute_change: 2, percent_change: null });
  const selected = build({ scope: { ...scope, employee: b } });
  expect(selected.cohort).toEqual(report.cohort); expect(selected.retained_record_history.employees).toEqual(report.retained_record_history.employees);
  expect(selected.retained_record_history.current).toBe(1);
  expect(build({ calls: [call(1), call(2), call(3, a, "2026-09-06T04:00:00Z")] }).retained_record_history.comparison).toMatchObject({ absolute_change: 1, percent_change: 100 });
  expect(build({ scope: parseHistoryScope(new URLSearchParams("from=2026-09-09&to=2026-09-09"), now)! }).retained_record_history.comparison).toMatchObject({ available: false, reason: "PARTIAL_CURRENT_DAY" });
  const missing = build({ sourceError: "capped" });
  expect(missing.retained_record_history.current).toBeNull(); expect(missing.retained_record_history.daily).toEqual([null, null]);
  expect(historyReportSchema.safeParse({ ...report, retained_record_history: { ...report.retained_record_history, employees: [...report.retained_record_history.employees].reverse() } }).success).toBe(false);
});

it("retains microsecond keysets under one-row caps and charges actual EOF, Auth and cohort requests", async () => {
  jest.useFakeTimers().setSystemTime(new Date(now));
  const seen = transport({ call_logs: [[call(1, a, "2026-09-07T04:00:00.000001+00:00")], [call(2, b, "2026-09-07T04:00:00.000002+00:00")], []] });
  const response = await teamGET(request()), report = await response.json();
  expect(response.status).toBe(200);
  expect(report.retained_record_history.current).toBe(2);
  expect(report.diagnostics).toMatchObject({ reader_http_requests: 5, authorization_db_http_requests: 2, auth_http_requests: 1 });
  const reads = seen.filter(url => url.pathname.endsWith("/call_logs"));
  expect(reads).toHaveLength(3);
  expect(reads.every(url => url.searchParams.get("user_id") === `in.(${a},${b})`)).toBe(true);
  expect(reads[1].searchParams.get("or")).toContain("timestamp.eq.2026-09-07T04:00:00.000001Z");
  expect(historyTimestamp("2026-09-07T09:30:00.123456+05:30")).toBe("2026-09-07T04:00:00.123456Z");
});

it("rejects foreign cohort selection before source reads and keeps live Admin authorization", async () => {
  for (const options of [{ active: false }, { admin: false }]) {
    const seen = transport({}, options); expect((await teamGET(request())).status).toBe(403);
    expect(seen.some(url => url.pathname.endsWith("/call_logs"))).toBe(false);
  }
  const seen = transport({}); expect((await teamGET(request(`${query}&employee=${id(9)}`))).status).toBe(404);
  expect(seen.some(url => url.pathname.endsWith("/call_logs"))).toBe(false);
});

it("forces My Day to the verified actor, rejecting every caller-selected identity and Mapping override", async () => {
  for (const override of [`employee=${b}`, `user_id=${b}`, "cohort=all", "metric=mappings_completed", "metric=visits&metric=calls_made"]) {
    const seen = transport({}); expect((await selfGET(request(`${query}&${override}`))).status).toBe(400);
    expect(seen).toHaveLength(2);
  }
  const seen = transport({ call_logs: [[call(1)], []] });
  const response = await selfGET(request()), report = await response.json();
  expect(response.status).toBe(200); expect(report.kind).toBe("self-history-v1");
  expect(report.cohort).toEqual({ definition: "verified-self", count: 1, members: [a] });
  expect(report.diagnostics).toMatchObject({ auth_http_requests: 1, authorization_db_http_requests: 1, reader_http_requests: 2 });
  expect(seen.every(url => !url.pathname.endsWith("/user_capabilities") && !url.pathname.includes("pipeline"))).toBe(true);
  expect(seen.filter(url => url.pathname.endsWith("/call_logs")).every(url => url.searchParams.get("user_id") === `in.(${a})`)).toBe(true);
});

it("uses canonical Visit dates and withholds legacy Calls when Visits is selected", async () => {
  transport({ field_visits: [[{ visit_id: id(1), user_id: a, visit_date: "2026-09-07", check_in_time: "2026-09-06T18:29:59Z" }], []] });
  const response = await selfGET(request(`${query}&metric=visits`)), report = await response.json();
  expect(response.status).toBe(200); expect(report.retained_record_history.daily).toEqual([1, 0]);
  expect(report.totals.retained_calls).toBeNull(); expect(report.totals.complete_calls).toBeNull();
});

it("keeps Mapping as current completion snapshots; reopen removes and recompletion restamps attribution", () => {
  const scope = parseHistoryScope(new URLSearchParams(`${query}&metric=mappings_completed`), now)!;
  const event = { id: id(1), user_id: a, date: "2026-09-07", timestamp: "2026-09-07T04:00:00Z" };
  const build = (events: typeof event[]) => buildHistoryReport({ scope, generatedAt: now, members, calls: [], events, requests: 4 }).retained_record_history;
  expect(build([event]).employees.map(row => row.current)).toEqual([1, 0]);
  expect(build([]).current).toBe(0);
  const recompleted = build([{ ...event, user_id: b, date: "2026-09-08", timestamp: "2026-09-08T04:00:00Z" }]);
  expect(recompleted.employees.map(row => row.current)).toEqual([0, 1]); expect(recompleted.daily).toEqual([0, 1]);
  expect(recompleted.previous).toBeNull(); expect(recompleted.comparison).toMatchObject({ available: false, reason: "MUTABLE_COMPLETION_SNAPSHOT" });
});

it.each(["visits", "mappings_completed"] as const)("fails closed on malformed, foreign, out-of-order and capped %s responses", async metric => {
  const row = (n: number, user = a) => metric === "visits"
    ? { visit_id: id(n), user_id: user, visit_date: "2026-09-07", check_in_time: "2026-09-07T04:00:00Z" }
    : { request_id: id(n), mapped_by: user, mapped_by_id_snapshot: user, completed_at: "2026-09-07T04:00:00Z", status: "Completed" };
  const table = metric === "visits" ? "field_visits" : "mapping_requests";
  for (const pages of [[[row(1, id(99))]], [[row(2), row(1)]], [[row(1)], [row(1)]], [[{ ...row(1), ...(metric === "visits" ? { visit_date: "2026-09-04" } : { mapped_by: b }) }]], [[{ ...row(1), ...(metric === "visits" ? { check_in_time: null } : { mapped_by_id_snapshot: null }) }]], [Array.from({ length: 1001 }, (_, n) => row(n))]]) {
    transport({ [table]: pages });
    const response = await teamGET(request(`${query}&metric=${metric}`)), report = await response.json();
    expect(response.status).toBe(200); expect(report.retained_record_history.source_read).toBe("unavailable");
    expect(report.retained_record_history.current).toBeNull();
  }
  const seen = transport({ [table]: [[row(1)], []] });
  const response = await teamGET(request(`${query}&metric=${metric}`)), report = await response.json();
  expect(report.retained_record_history.current).toBe(1);
  expect(seen.filter(url => url.pathname.endsWith(`/${table}`))).toHaveLength(2);
  if (metric === "mappings_completed") {
    expect(seen.find(url => url.pathname.endsWith(`/${table}`))!.searchParams.getAll("completed_at")[0]).toContain("2026-09-06T18:30:00.000000Z");
    expect(report.retained_record_history.previous).toBeNull();
  }
});

// Real HTTP, enabled only by the disposable GitHub runner fixture.
(process.env.BCD_HTTP_FIXTURE_TOKEN ? describe : describe.skip)("real PostgREST retained history", () => {
  it.each(["calls_made", "mappings_completed"] as const)("exhausts native %s with exact identities, microsecond cursors and foreign-author exclusion", async metric => {
    expect(process.platform).toBe("linux"); expect(process.env.GITHUB_ACTIONS).toBe("true");
    expect(process.env.CRM_POSTGRES_SERVICE_DISPOSABLE).toBe("1"); expect(process.env.PGHOST).toBe("127.0.0.1");
    expect(process.env.PGDATABASE).toMatch(/^kernel_bcd_readers_postgres_[a-f0-9]{8}_0$/);
    const uuid = (name: string) => { const h = createHash("md5").update(name).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
    const cohort = [uuid("user1"), ...Array.from({ length: 199 }, (_, n) => uuid(`absent-history-user${n}`))];
    const mapping = metric === "mappings_completed", table = mapping ? "mapping_requests" : "call_logs";
    const generatedAt = new Date().toISOString();
    const date = mapping ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(generatedAt)) : "2026-09-08";
    const resource = createReportResource(new AbortController().signal), targets: string[] = [];
    const client = createClient("http://127.0.0.1:3103", process.env.BCD_HTTP_FIXTURE_TOKEN!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "http://127.0.0.1:3103" || url.pathname !== `/rest/v1/${table}`) throw Error("FIXTURE_HTTP_SCOPE");
      url.pathname = `/${table}`; targets.push(url.pathname + url.search); return resource.fetch(url, init);
    } } });
    try {
      // CI may cross IST midnight after the lifecycle fixture completes.
      const from = mapping ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.parse(generatedAt) - 86400000)) : date;
      const scope = parseHistoryScope(new URLSearchParams(`from=${from}&to=${date}&metric=${metric}`), generatedAt)!;
      const result = await readRetainedHistory(client, scope, cohort, generatedAt, resource);
      const expected = mapping ? Array.from({ length: 101 }, (_, n) => uuid(`history-mapping${n + 1}`))
        : [...Array.from({ length: 120 }, (_, n) => uuid(`busy-call${n + 1}`)), ...Array.from({ length: 101 }, (_, n) => uuid(`micro-call${n + 1}`))];
      expect(result.events.map(row => row.id).sort()).toEqual(expected.sort());
      expect(result.events.every(row => row.user_id === uuid("user1"))).toBe(true);
      expect(targets).toHaveLength(mapping ? 3 : 4);
      expect(resource.diagnostics.reader_http_requests).toBe(targets.length);
      expect(targets.slice(1).every(target => new URL(target, "http://127.0.0.1:3103").searchParams.has("or"))).toBe(true);
      if (!mapping) expect(result.events.find(row => row.id === uuid("micro-call1"))?.timestamp).toBe("2026-09-08T04:00:00.000001Z");
      console.log(JSON.stringify({ native_history_http: metric, cohort: cohort.length, exact_ids: expected.length, requests_including_eof: targets.length, maximum_request_target_bytes: Math.max(...targets.map(target => Buffer.byteLength(target))), ...resource.diagnostics }));
    } finally { resource.finish(); }
  }, 15000);
  it("exhausts the 200-identity native Visit predicate through capped first and cursor HTTP requests", async () => {
    expect(process.platform).toBe("linux"); expect(process.env.GITHUB_ACTIONS).toBe("true");
    expect(process.env.CRM_POSTGRES_SERVICE_DISPOSABLE).toBe("1"); expect(process.env.PGHOST).toBe("127.0.0.1");
    expect(process.env.PGDATABASE).toMatch(/^kernel_bcd_readers_postgres_[a-f0-9]{8}_0$/);
    const uuid = (name: string) => { const h = createHash("md5").update(name).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
    const cohort = Array.from({ length: 200 }, (_, n) => uuid(`user${n + 1}`));
    const resource = createReportResource(new AbortController().signal), lengths: number[] = [];
    const client = createClient("http://127.0.0.1:3103", process.env.BCD_HTTP_FIXTURE_TOKEN!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== "http://127.0.0.1:3103" || url.pathname !== "/rest/v1/field_visits") throw Error("FIXTURE_HTTP_SCOPE");
      url.pathname = "/field_visits"; lengths.push(Buffer.byteLength(url.pathname + url.search));
      return resource.fetch(url, init);
    } } });
    try {
      const scope = parseHistoryScope(new URLSearchParams("from=2026-08-01&to=2026-08-03&metric=visits"), now)!;
      const result = await readRetainedHistory(client, scope, cohort, now, resource);
      expect(result.events).toHaveLength(1063); expect(new Set(result.events.map(row => row.id)).size).toBe(1063);
      expect(resource.diagnostics.reader_http_requests).toBe(12);
      expect(lengths).toHaveLength(12); expect(lengths[1]).toBeGreaterThan(lengths[0]);
      console.log(JSON.stringify({ native_history_http: "visits", cohort: 200, events: 1063, requests_including_eof: lengths.length, maximum_request_target_bytes: Math.max(...lengths), ...resource.diagnostics }));
    } finally { resource.finish(); }
  }, 15000);
});
