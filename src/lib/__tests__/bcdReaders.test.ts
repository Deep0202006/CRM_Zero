/** @jest-environment node */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { aggregateVisitRange, parseVisitRange, parseVisitRegister, visitRegisterResultSchema, visitRangeReportSchema, readVisitEvents, type VisitEvent } from "../fieldVisits/range";
import { boundedReportJson, createReportResource } from "../analytics/reportResource";
import { createServerServiceClient } from "../serverBackendEnvironment";
import { GET } from "@/app/api/admin/visits/analysis/route";
import { GET as registerGET } from "@/app/api/admin/visits/route";
import { GET as pickerGET } from "@/app/api/admin/visits/representatives/route";
import { adminVisitOutcomeLabel, initialVisitQuery, visitQueryKey, visitQueryParams } from "../fieldVisits/query";

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
  it("keeps Pipeline inner-plan fixture arguments aligned with every prepared SQL parameter", () => {
    const source = readFileSync("scripts/bcd-db/http.mjs", "utf8");
    const rows = [...source.matchAll(/\['pipeline-(register|history)', '[^']+', \[([^\]]+)\], '([^']+)', "([^"]+)"\]/g)];
    expect(rows.map(row => row[1])).toEqual(["register", "history"]);
    for (const row of rows) {
      const names = row[2].split(","), types = row[3].split(","), args = row[4].split(",");
      expect(types).toHaveLength(names.length);
      expect(args).toHaveLength(names.length);
      if (row[1] === "register") {
        expect(names).toHaveLength(12);
        expect(args.slice(7, 11)).toEqual(["true", "true", "true", "true"]);
        expect(args[11]).toBe("'2026-09-09'");
      }
    }
  });
  it("reconciles full-range daily, outcome and representative counts without accepting unavailable or truncated charts", () => {
    const report = { kind: "visit-range-v1", scope: scope(), generated_at: "2026-09-09T06:00:00Z",
      retained_source_read: "exhausted", historical_coverage: "uncertified", consistency: "bounded-live-multi-request",
      ...aggregateVisitRange(scope(), [event(1), event(2)]) };
    expect(visitRangeReportSchema.parse(report).daily).toEqual([{ date: "2026-09-07", count: 2 }, { date: "2026-09-08", count: 0 }]);
    for (const change of [{ daily: report.daily.slice(0, 1) }, { retained_source_read: "unavailable" }, { retained_visit_count: 3 },
      { representatives: [] }, { outcomes: [{ outcome: "interested", count: 1 }] }, { date_mismatch_count: 3 }]) {
      expect(visitRangeReportSchema.safeParse({ ...report, ...change }).success).toBe(false);
    }
    expect(visitRangeReportSchema.safeParse({ ...report, representatives: null, representative_breakdown: "unavailable-cardinality-limit" }).success).toBe(true);
    expect(adminVisitOutcomeLabel("legacy_unknown")).toBe("Legacy unknown");
    expect(adminVisitOutcomeLabel("registered")).toBe("New Registration");
    expect(adminVisitOutcomeLabel("payment_follow_up")).toBe("Payment follow-up");
  });
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
  it("bounds representative labels within the same analysis resource and exposes capped names as unavailable", async () => {
    for (const capped of [false, true]) {
      let pages = 0;
      const fetcher = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation(async input => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/auth/v1/user")) return Response.json({ id: actor });
        if (url.pathname.endsWith("/users")) return url.searchParams.get("select") === "is_active" ? Response.json([{ is_active: true }]) : Response.json(capped ? [] : [{ user_id: actor, name: "Retained author" }], { headers: { "Content-Range": "0-0/1" } });
        if (url.pathname.endsWith("/user_capabilities")) return Response.json([{ capability_code: "admin" }]);
        if (url.pathname.endsWith("/rpc/crm_visit_events_v1")) return Response.json(pages++ ? [] : [event(1)]);
        throw Error("Unexpected analysis request");
      });
      scopedBackend(fetcher);
      const response = await GET(new Request("https://fixture.invalid/api?date_from=2026-09-07&date_to=2026-09-08", { headers: { Authorization: "Bearer synthetic" } }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.representatives).toEqual([{ user_id: actor, count: 1, name: capped ? null : "Retained author" }]);
      expect(body.diagnostics).toMatchObject({ reader_http_requests: 3, authorization_db_http_requests: 2, auth_http_requests: 1 });
      expect(visitRangeReportSchema.safeParse(body).success).toBe(true);
    }
  });
  it("rejects ambiguous register dates, invalid pagination and partial counts", () => {
    for (const query of ["date_from=2026-09-01", "date_from=2026-09-01&date_to=2026-09-07&date=2026-09-01", "page=401", "page=0", "page=1.5", "page=1&page=2", "employee=x"]) {
      expect(() => parseVisitRegister(new URLSearchParams(query), "2026-09-09T06:00:00Z")).toThrow();
    }
    expect(parseVisitRegister(new URLSearchParams("date=2026-09-08"), "2026-09-09T06:00:00Z").date).toBe("2026-09-08");
    const result={visit_ids:[event(1).visit_id],total:1,page:1,page_size:50,has_more:false,page_limit:400,legacy_date_mismatch_count:0};
    expect(visitRegisterResultSchema.safeParse(result).success).toBe(true);
    for(const change of [{total:2},{has_more:true},{visit_ids:[event(1).visit_id,event(1).visit_id],total:2}]) expect(visitRegisterResultSchema.safeParse({...result,...change}).success).toBe(false);
  });
  it("keeps register and independent picker behind live active Admin checks", async () => {
    for(const handler of [registerGET,pickerGET]) for(const [active,admin] of [[false,true],[true,false]]) {
      const fetcher=jest.fn<ReturnType<typeof fetch>,Parameters<typeof fetch>>().mockImplementation(async(url)=>{
        const path=new URL(String(url)).pathname;
        if(path.endsWith('/auth/v1/user'))return Response.json({id:actor});
        if(path.endsWith('/users'))return Response.json([{is_active:active}]);
        if(path.endsWith('/user_capabilities'))return Response.json(admin ? [{capability_code:'admin'}] : [{capability_code:'task_assigner'}]);
        throw Error('Unauthorized reader request');
      });
      scopedBackend(fetcher);
      expect((await handler(new Request('https://fixture.invalid/api',{headers:{Authorization:'Bearer synthetic'}}))).status).toBe(403);
      expect(fetcher).toHaveBeenCalledTimes(3);
    }
  });
  it("reconciles bounded register enrichment and rejects a server-capped lead response", async () => {
    for(const capped of [false,true]) {
      const records=[1,2,3].map(n=>({...event(n),lead_id:event(n+10).visit_id,created_at:'2026-09-07T00:00:00Z'}));
      const fetcher=jest.fn<ReturnType<typeof fetch>,Parameters<typeof fetch>>().mockImplementation(async(url,init)=>{
        const parsed=new URL(String(url)),path=parsed.pathname;
        if(path.endsWith('/auth/v1/user'))return Response.json({id:actor});
        if(path.endsWith('/users'))return Response.json(parsed.searchParams.get('select')==='is_active' ? [{is_active:true}] : [{user_id:actor,name:'Field employee',email:'fixture@example.invalid'}]);
        if(path.endsWith('/user_capabilities'))return Response.json([{capability_code:'admin'}]);
        if(path.endsWith('/rpc/crm_visit_register_v1'))return Response.json({visit_ids:records.map(row=>row.visit_id),total:3,page:1,page_size:50,has_more:false,page_limit:400,legacy_date_mismatch_count:0});
        if(path.endsWith('/field_visits'))return init?.method==='HEAD' ? new Response(null,{headers:{'Content-Range':'*/3'}}) : Response.json(records,{headers:{'Content-Range':'0-2/3'}});
        if(path.endsWith('/leads'))return Response.json(records.slice(0,capped?2:3).map(row=>({lead_id:row.lead_id,business_name:'Business',contact_person:'Contact',phone:'555'})),{headers:{'Content-Range':capped?'0-1/3':'0-2/3'}});
        throw Error('Unexpected register transport');
      });
      scopedBackend(fetcher);
      const response=await registerGET(new Request('https://fixture.invalid/api?date_from=2026-09-07&date_to=2026-09-08',{headers:{Authorization:'Bearer synthetic'}}));
      expect(response.status).toBe(capped?503:200);
      const body=await response.json();
      if(capped)expect(body.error).toBe('VISIT_IDENTITIES_UNAVAILABLE');
      else {expect(body.visits).toHaveLength(3);expect(body.visits.every((row:{leads:unknown})=>row.leads)).toBe(true);expect(body.diagnostics).toMatchObject({auth_http_requests:1,authorization_db_http_requests:2,reader_http_requests:6});}
    }
  });
  it("preserves unsearched records before activation without pretending joined search is complete", async () => {
    const fetcher=jest.fn<ReturnType<typeof fetch>,Parameters<typeof fetch>>().mockImplementation(async(url)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith('/auth/v1/user'))return Response.json({id:actor});
      if(path.endsWith('/users'))return Response.json([{is_active:true}]);
      if(path.endsWith('/user_capabilities'))return Response.json([{capability_code:'admin'}]);
      if(path.endsWith('/rpc/crm_visit_register_v1'))return Response.json({code:'PGRST202',message:'not activated'},{status:404});
      if(path.endsWith('/field_visits'))return Response.json([],{headers:{'Content-Range':'*/0'}});
      throw Error('Unexpected activation fallback read');
    });
    scopedBackend(fetcher);
    const request=(search='')=>new Request(`https://fixture.invalid/api?date_from=2026-09-07&date_to=2026-09-08${search}`,{headers:{Authorization:'Bearer synthetic'}});
    const response=await registerGET(request());expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({reader_activation:'pending',visits:[],total:0});
    const previous=fetcher.mock.calls.length;
    expect((await registerGET(request('&search=Matching'))).status).toBe(503);
    expect(fetcher.mock.calls.slice(previous).filter(([url])=>String(url).includes('/field_visits'))).toHaveLength(0);
  });
  it("accepts the exact bounded PostgreSQL Unicode cursor through picker input and output", async () => {
    const cursor='z'+'😀'.repeat(999);
    const fetcher=jest.fn<ReturnType<typeof fetch>,Parameters<typeof fetch>>().mockImplementation(async(url,init)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith('/auth/v1/user'))return Response.json({id:actor});
      if(path.endsWith('/users'))return Response.json([{is_active:true}]);
      if(path.endsWith('/user_capabilities'))return Response.json([{capability_code:'admin'}]);
      expect(JSON.parse(String(init?.body))).toMatchObject({p_after_name:cursor,p_after_id:actor});
      return Response.json({items:[{user_id:event(1).visit_id,name:cursor+'😀',email:'unicode@example.invalid',is_active:true,historical_only:false,cursor_name:cursor}],selected:null,has_more:false});
    });
    scopedBackend(fetcher);
    const params=new URLSearchParams({after_name:cursor,after_id:actor});
    const response=await pickerGET(new Request(`https://fixture.invalid/api?${params}`,{headers:{Authorization:'Bearer synthetic'}}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({items:[{cursor_name:cursor}],diagnostics:{auth_http_requests:1,authorization_db_http_requests:2,reader_http_requests:1}});
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
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
