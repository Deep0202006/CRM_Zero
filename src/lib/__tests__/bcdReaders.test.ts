/** @jest-environment node */
import { createClient } from "@supabase/supabase-js";
import { aggregateVisitRange, parseVisitRange, readVisitEvents, type VisitEvent } from "../fieldVisits/range";
import { boundedReportJson, createReportResource } from "../analytics/reportResource";
import { createServerServiceClient } from "../serverBackendEnvironment";
import { GET } from "@/app/api/admin/visits/analysis/route";

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
      jest.mocked(createServerServiceClient).mockReturnValue({ ok: true, client: client(fetcher) });
      const response = await GET(new Request("https://fixture.invalid/api?date_from=2026-09-07&date_to=2026-09-08", { headers: { Authorization: "Bearer synthetic-token" } }));
      expect(response.status).toBe(expected);
      expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/rpc/")).length).toBe(admin && active ? 1 : 0);
      if (expected === 200) expect(await response.json()).toMatchObject({ retained_source_read: "exhausted", historical_coverage: "uncertified", diagnostics: { reader_requests: 1, authorization_db_requests: 2 } });
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
    try {
      await expect(readVisitEvents(client(fetcher), scope(), resource)).rejects.toThrow("VISIT_SOURCE_UNAVAILABLE");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(resource.diagnostics.reader_requests).toBe(1);
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
});
