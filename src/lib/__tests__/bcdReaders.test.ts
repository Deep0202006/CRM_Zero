/** @jest-environment node */
import { createClient } from "@supabase/supabase-js";
import { aggregateVisitRange, parseVisitRange, readVisitEvents, type VisitEvent } from "../fieldVisits/range";
import { boundedReportJson, createReportResource } from "../analytics/reportResource";
import { createServerServiceClient } from "../serverBackendEnvironment";
import { GET } from "@/app/api/admin/visits/analysis/route";
import { initialVisitQuery, visitQueryKey, visitQueryParams } from "../fieldVisits/query";

jest.mock("../serverBackendEnvironment", () => ({
  createServerServiceClient: jest.fn(),
  backendUnavailableResponse: () => Response.json({ error: "CRM_UNAVAILABLE" }, { status: 503 }),
}));

const actor = "00000000-0000-4000-8000-000000000001";
const scope = () => parseVisitRange(new URLSearchParams("date_from=2026-09-07&date_to=2026-09-08"), "2026-09-09T06:00:00Z");
const event = (n: number): VisitEvent => ({ visit_id: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`, user_id: actor,
  visit_date: "2026-09-07", check_in_time: "2026-09-06T18:30:00Z", visit_outcome: "interested", segment_type: "Retailer" });
const client = (fetch: typeof globalThis.fetch) => createClient("https://fixture.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
});

describe("B-D bounded read slice", () => {
  it("keeps a captured query independent of draft edits and serializes legacy and range scopes distinctly", () => {
    const applied = { ...initialVisitQuery(), dateFrom: "2026-09-01", dateTo: "2026-09-07", search: "Literal, (business)%" };
    const draft = { ...applied, search: "new filter" };
    expect(visitQueryParams(applied).get("search")).toBe("Literal, (business)%");
    expect(visitQueryKey(draft)).not.toBe(visitQueryKey(applied));
    expect(visitQueryParams(applied).has("representative")).toBe(false);
    const legacy = visitQueryParams({ ...applied, date: "2026-09-05", representative: actor });
    expect(legacy.get("date")).toBe("2026-09-05");
    expect(legacy.has("date_from")).toBe(false);
    expect(legacy.has("date_to")).toBe(false);
    expect(legacy.get("representative")).toBe(actor);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  const scopedBackend = (fetcher: typeof fetch) => {
    jest.spyOn(globalThis, "fetch").mockImplementation(fetcher);
    jest.mocked(createServerServiceClient).mockImplementation((options) => ({ ok: true, client: client(options!.fetch!) }));
  };
  it("does no Auth transport work for an already-aborted request", async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    scopedBackend(fetcher);
    const incoming = new AbortController(); incoming.abort();
    const response = await GET(new Request("https://fixture.invalid/api", { signal: incoming.signal, headers: { Authorization: "Bearer synthetic" } }));
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts delayed Auth at the shared deadline, schedules no DB work and clears timers", async () => {
    jest.useFakeTimers();
    let transportAborted = false;
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => { transportAborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    }));
    scopedBackend(fetcher);
    const pending = GET(new Request("https://fixture.invalid/api", { headers: { Authorization: "Bearer synthetic" } }));
    await jest.advanceTimersByTimeAsync(8001);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(transportAborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ generated_at: null, diagnostics: { auth_http_requests: 1, authorization_db_http_requests: 0, reader_http_requests: 0 } });
    expect(jest.getTimerCount()).toBe(0);
  });
  it("keeps Preview unavailable and rejects missing credentials without report reads", async () => {
    jest.mocked(createServerServiceClient).mockReturnValue({ ok: false });
    expect((await GET(new Request("https://fixture.invalid/api"))).status).toBe(503);
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    jest.mocked(createServerServiceClient).mockReturnValue({ ok: true, client: client(fetcher) });
    expect((await GET(new Request("https://fixture.invalid/api"))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("checks live active Admin authorization before reading any Visit scope", async () => {
    for (const [active, admin, expected] of [[true, false, 403], [false, true, 403], [true, true, 200]] as const) {
      const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async (url) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/auth/v1/user")) return Response.json({ id: actor });
        if (path.endsWith("/users")) return Response.json([{ is_active: active }]);
        if (path.endsWith("/user_capabilities")) return Response.json(admin ? [{ capability_code: "admin" }] : [{ capability_code: "task_assigner" }]);
        return Response.json([]);
      });
      scopedBackend(fetcher);
      const response = await GET(new Request("https://fixture.invalid/api?date_from=2026-09-07&date_to=2026-09-08", { headers: { Authorization: "Bearer synthetic-token" } }));
      expect(response.status).toBe(expected);
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/rpc/")).length).toBe(admin && active ? 1 : 0);
      if (expected === 200) expect(await response.json()).toMatchObject({ retained_source_read: "exhausted", historical_coverage: "uncertified", diagnostics: { reader_requests: 1, authorization_db_requests: 2, auth_http_requests: 1, authorization_db_http_requests: 2, reader_http_requests: 1 } });
    }
  });
  it("validates real bounded IST dates and rejects duplicate or unknown scope", () => {
    for (const q of ["date_from=2026-02-30", "date_from=2026-08-01&date_to=2026-09-08", "date_to=2026-09-10",
      "date_from=2026-09-09&date_to=2026-09-08", "representative=bad", "employee=someone", "search=a&search=b"]) {
      expect(() => parseVisitRange(new URLSearchParams(q), "2026-09-09T06:00:00Z")).toThrow();
    }
    expect(parseVisitRange(new URLSearchParams(), "2026-09-08T18:30:00Z").date_to).toBe("2026-09-09");
  });
  it("reconciles canonical date counts, unique identities and unknown outcomes without inventing coverage", () => {
    const row = event(1), mismatch = { ...event(2), visit_outcome: null, check_in_time: "2026-09-06T18:29:59Z" };
    const result = aggregateVisitRange(scope(), [row, row, mismatch]);
    expect(result.retained_visit_count).toBe(2);
    expect(result.daily.map((day) => day.count)).toEqual([2, 0]);
    expect(result.outcomes).toContainEqual({ outcome: "unknown", count: 1 });
    expect(result.representatives?.[0].count).toBe(2);
    expect(result.date_mismatch_count).toBe(1);
  });
  it("continues SDK requests after short pages and charges the empty EOF", async () => {
    const bodies: unknown[] = [];
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(bodies.length <= 2 ? [event(bodies.length)] : []);
    });
    const resource = createReportResource(new AbortController().signal);
    try {
      expect(await readVisitEvents(client(fetcher), scope(), resource)).toHaveLength(2);
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(bodies[1]).toMatchObject({ p_after_id: event(1).visit_id });
      expect(resource.diagnostics.reader_requests).toBe(3);
    } finally { resource.finish(); }
  });
  it("disables the installed SDK retry on a physical 503 response", async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(Response.json({ message: "temporary", code: "XX000" }, { status: 503 }));
    const resource = createReportResource(new AbortController().signal);
    jest.spyOn(globalThis, "fetch").mockImplementation(fetcher);
    try {
      await expect(readVisitEvents(client(resource.fetch), scope(), resource)).rejects.toThrow("VISIT_SOURCE_UNAVAILABLE");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(resource.diagnostics.reader_requests).toBe(1);
      expect(resource.diagnostics.reader_http_requests).toBe(1);
    } finally { resource.finish(); }
  });
  it("does not publish a response or schedule another page after cancellation", async () => {
    const incoming = new AbortController();
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async () => { incoming.abort(); return Response.json([event(1)]); });
    const resource = createReportResource(incoming.signal);
    try {
      await expect(readVisitEvents(client(fetcher), scope(), resource)).rejects.toThrow("REPORT_CANCELLED_OR_DEADLINE");
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { resource.finish(); }
  });
  it("withholds malformed, foreign and nonprogressing source pages", async () => {
    for (const row of [{ ...event(1), visit_date: "2026-09-06" }, { ...event(1), visit_id: "bad" }, event(1)]) {
      const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async () => Response.json([row]));
      const resource = createReportResource(new AbortController().signal);
      try { await expect(readVisitEvents(client(fetcher), scope(), resource)).rejects.toThrow(); }
      finally { resource.finish(); }
    }
  });
  it("enforces report request and UTF-8 payload limits", async () => {
    const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async () => Response.json([]));
    const resource = createReportResource(new AbortController().signal, 1);
    try {
      await resource.read(client(fetcher).rpc("crm_visit_events_v1"));
      await expect(resource.read(client(fetcher).rpc("crm_visit_events_v1"))).rejects.toThrow("REPORT_REQUEST_LIMIT");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(() => boundedReportJson({ value: "₹".repeat(20) }, 40)).toThrow("REPORT_PAYLOAD_LIMIT");
    } finally { resource.finish(); }
  });
  it("consumes each physical allowance once and strips its internal header", async () => {
    const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([]));
    const resource = createReportResource(new AbortController().signal);
    try {
      await expect(resource.fetch("https://fixture.invalid/rest/v1/users")).rejects.toThrow("UNCHARGED_REPORT_HTTP_REQUEST");
      await resource.read(client(resource.fetch).rpc("crm_visit_events_v1"));
      expect(new Headers(fetcher.mock.calls[0][1]?.headers).has("x-zd-report-read")).toBe(false);
      await expect(resource.fetch("https://fixture.invalid/rest/v1/users", { headers: { "x-zd-report-read": "reader:1" } })).rejects.toThrow("UNCHARGED_REPORT_HTTP_REQUEST");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(resource.diagnostics.reader_http_requests).toBe(1);
    } finally { resource.finish(); }
  });
});
