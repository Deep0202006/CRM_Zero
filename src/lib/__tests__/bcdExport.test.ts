/** @jest-environment node */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as xlsx from "xlsx";
import { createReportResource } from "../analytics/reportResource";
import { parseVisitExport, readVisitExport, readVisitExportErp, buildVisitExportWorkbook, exportErpSchema, type VisitExportRow } from "../fieldVisits/export";
import { initialVisitQuery, visitQueryParams } from "../fieldVisits/query";
import { createServerServiceClient } from "../serverBackendEnvironment";
import { GET } from "@/app/api/admin/export-visits/route";

jest.mock("../serverBackendEnvironment", () => ({ createServerServiceClient: jest.fn(), backendUnavailableResponse: () => Response.json({}, { status: 503 }) }));
const actor = "00000000-0000-4000-8000-000000000001";
const scope = () => parseVisitExport(new URLSearchParams("date_from=2026-08-01&date_to=2026-08-03"), "2026-09-09T00:00:00Z");
const row = (n: number): VisitExportRow => ({
  visit_id: `10000000-0000-4000-8000-${String(999999-n).padStart(12,"0")}`, user_id: actor, lead_id: "legacy-text",
  created_at: "2026-08-03T04:00:00.000001Z", visit_date: "2026-08-03", check_in_time: "2026-08-03T04:00:00Z",
  check_in_lat: null, check_in_lng: null, address: null, pincode: null, segment_type: "Retailer", person_met: null,
  visit_outcome: "interested", visit_notes: null, follow_up_date: null, erp_usage_state: null, erp_name: null,
  representative_name: "Synthetic", representative_email: null, business_name: null, selfie_status: "pending",
});
const emptySegment = { unique_businesses: 0, observed_count: 0, erp_using_count: 0, none_count: 0, not_captured_count: 0, coverage_percent: 0, categories: [] };
const emptyErp = () => exportErpSchema.parse({ Retailer: emptySegment, Distributor: emptySegment });
const client = (fetcher: typeof fetch, key = "synthetic-key", origin = "https://fixture.invalid") => createClient(origin, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe("bounded Visits export", () => {
  it("shares applied query normalization and rejects malformed or ambiguous scope", () => {
    const applied = { ...initialVisitQuery(), dateFrom: "2026-08-01", dateTo: "2026-08-03", search: "  %_,().  ", representative: actor };
    const draft = { ...applied, search: "failed draft" };
    expect(parseVisitExport(visitQueryParams(applied), "2026-09-09T00:00:00Z")).toMatchObject({ search: "%_,().", representative: actor });
    expect(parseVisitExport(visitQueryParams(draft), "2026-09-09T00:00:00Z").search).not.toBe("%_,().");
    expect(parseVisitExport(new URLSearchParams(`date=2026-08-01&agent=${actor}`), "2026-09-09T00:00:00Z").representative).toBe(actor);
    for (const query of ["", "page=1", "date_from=2026-08-01", "date_from=2026-08-01&date_to=2026-09-01", "date=2026-02-30",
      `date=2026-08-01&agent=${actor}&representative=${actor}`, `date=2026-08-01&agent=${actor}&agent=${actor}`,
      "date=2026-08-01&search=a&search=b", "date=2026-08-01&employee=x"]) expect(() => parseVisitExport(new URLSearchParams(query), "2026-09-09T00:00:00Z")).toThrow();
  });

  it.each([5000, 5001])("requires charged EOF and never returns a partial %i-row export", async size => {
    let received = 0;
    const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const batch = Array.from({ length: Math.min(500, size-received) }, (_, i) => row(received+i));
      received += batch.length; return Response.json(batch);
    });
    const resource = createReportResource(new AbortController().signal);
    try {
      if (size === 5000) {
        const rows = await readVisitExport(client(resource.fetch), scope(), resource);
        expect(rows).toHaveLength(5000);
        const buffer = buildVisitExportWorkbook(rows, emptyErp(), scope(), resource);
        expect(xlsx.utils.sheet_to_json(xlsx.read(buffer).Sheets["Field Visits"])).toHaveLength(5000);
      } else await expect(readVisitExport(client(resource.fetch), scope(), resource)).rejects.toThrow("VISIT_EXPORT_ROW_LIMIT");
      expect(fetcher).toHaveBeenCalledTimes(11);
      expect(resource.diagnostics.reader_http_requests).toBe(11);
    } finally { resource.finish(); }
  });

  it("cancellation during page2 schedules no page3 or ERP", async () => {
    const incoming = new AbortController(); let calls = 0;
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => { if (++calls === 2) incoming.abort(); return Response.json([row(calls)]); });
    const resource = createReportResource(incoming.signal);
    try { await expect(readVisitExport(client(resource.fetch), scope(), resource)).rejects.toThrow("REPORT_CANCELLED_OR_DEADLINE"); expect(calls).toBe(2); }
    finally { resource.finish(); }
  });

  it("bounds short non-EOF pages and rejects oversized source bytes", async () => {
    for (const oversized of [false, true]) {
      let calls = 0;
      jest.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(oversized
        ? Array.from({ length: 100 }, (_, i) => ({ ...row(i), visit_notes: "x".repeat(20000) })) : [row(++calls)]));
      const resource = createReportResource(new AbortController().signal);
      try {
        await expect(readVisitExport(client(resource.fetch), scope(), resource)).rejects.toThrow(oversized ? "VISIT_EXPORT_SOURCE_LIMIT" : "VISIT_EXPORT_REQUEST_LIMIT");
        expect(resource.diagnostics.reader_http_requests).toBe(oversized ? 1 : 23);
      } finally { resource.finish(); }
    }
  });

  it("does not return a workbook after serialization crosses the shared deadline", () => {
    const resource = createReportResource(new AbortController().signal);
    const check = jest.spyOn(resource, "check").mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementation(() => { throw Error("REPORT_CANCELLED_OR_DEADLINE"); });
    try { expect(() => buildVisitExportWorkbook([row(1)], emptyErp(), scope(), resource)).toThrow("REPORT_CANCELLED_OR_DEADLINE"); expect(check).toHaveBeenCalledTimes(3); }
    finally { resource.finish(); }
  });

  it.each(["duplicate", "cell", "page", "scope", "missing-rpc"])("fails closed for %s instead of creating a workbook", async failure => {
    const batch = failure === "duplicate" ? [row(1), row(1)] : failure === "page" ? Array.from({ length: 501 }, (_, i) => row(i))
      : [{ ...row(1), ...(failure === "cell" ? { visit_notes: "😀".repeat(16384) } : failure === "scope" ? { visit_date: "2026-08-04" } : {}) }];
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => failure === "missing-rpc" ? Response.json({ code: "PGRST202" }, { status: 404 }) : Response.json(batch));
    const resource = createReportResource(new AbortController().signal);
    try { await expect(readVisitExport(client(resource.fetch), scope(), resource)).rejects.toThrow(); expect(resource.diagnostics.reader_requests).toBe(1); }
    finally { resource.finish(); }
  });

  it("rejects missing, contradictory and oversized ERP rather than fabricating zeros", async () => {
    for (const value of [null, {}, { Retailer: emptySegment }, { Retailer: { ...emptySegment, unique_businesses: 1 }, Distributor: emptySegment },
      { Retailer: { ...emptySegment, categories: Array(1001).fill({ erp_name: "ERP", count: 0, share_percent: 0 }) }, Distributor: emptySegment }]) {
      jest.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(value));
      const resource = createReportResource(new AbortController().signal);
      try { await expect(readVisitExportErp(client(resource.fetch), resource)).rejects.toThrow(); }
      finally { resource.finish(); }
    }
  });

  it.each([[false, true], [true, false]])("requires live active admin before export (active %s admin %s)", async (active, admin) => {
    const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/auth/v1/user")) return Response.json({ id: actor });
      if (path.endsWith("/users")) return Response.json([{ is_active: active }]);
      if (path.endsWith("/user_capabilities")) return Response.json(admin ? [{ capability_code: "admin" }] : []);
      throw Error("Unauthorized reader");
    });
    jest.mocked(createServerServiceClient).mockImplementation(options => ({ ok: true, client: client(options!.fetch!) }));
    const response = await GET(new Request("https://fixture.invalid/api?date=2026-08-01", { headers: { Authorization: "Bearer synthetic" } }));
    expect(response.status).toBe(403); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

// Enabled only by the registered disposable PostgreSQL proof's guarded HTTP fixture.
const realHttp = process.env.BCD_HTTP_FIXTURE_TOKEN ? describe : describe.skip;
realHttp("real PostgREST exported Visit IDs", () => {
  beforeAll(() => {
    expect(process.platform).toBe("linux"); expect(process.env.GITHUB_ACTIONS).toBe("true");
    expect(process.env.CRM_POSTGRES_SERVICE_DISPOSABLE).toBe("1"); expect(process.env.PGHOST).toBe("127.0.0.1");
    expect(process.env.PGDATABASE).toMatch(/^kernel_bcd_readers_postgres_[a-f0-9]{8}_0$/);
  });
  const id = (name: string) => { const h=createHash("md5").update(name).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
  it.each([
    ["date_from=2026-08-01&date_to=2026-08-02&search=Matching business", 61],
    ["date_from=2026-08-01&date_to=2026-08-02&search=Matching representative", 62],
    ["date_from=2026-08-01&date_to=2026-08-02&search=%25", 0],
    ["date_from=2026-08-03&date_to=2026-08-03&search=%25_%2C().", 1],
    ["date=2026-08-01&search=legacy searchable", 1],
    ["date_from=2026-08-01&date_to=2026-08-01&search=legacy searchable", 0],
    ["date_from=2026-08-01&date_to=2026-08-02&representative=" + id("user61"), 2],
    ["date_from=2026-08-01&date_to=2026-08-03", 1063],
  ])("decodes actual workbook against SQL register predicate: %s", async (query, expectedCount) => {
    const captured = new URLSearchParams(query);
    const normalized = parseVisitExport(captured, "2026-09-09T00:00:00Z");
    // A failed draft never mutates the captured applied scope used by this export.
    const draft = new URLSearchParams(captured); draft.set("search", "failed draft");
    const literal = (value: string | null | undefined) => value == null ? "null" : `'${value.replaceAll("'", "''")}'`;
    const args = [normalized.date_from, normalized.date_to, normalized.representative, normalized.segment, normalized.outcome, normalized.search, normalized.date].map(literal).join(",");
    const expected = JSON.parse(execFileSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", `
      select coalesce(jsonb_agg(v.visit_id order by v.created_at desc,v.visit_id desc),'[]')
      from public.field_visits v left join public.users u on u.user_id=v.user_id left join public.leads l on v.lead_id=l.lead_id::text
      where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
        array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],${args});
    `], { encoding: "utf8", timeout: 8000 }));
    jest.mocked(createServerServiceClient).mockImplementation(options => {
      const transport: typeof fetch = (input, init) => {
        const url = new URL(String(input));
        if (url.origin !== "http://127.0.0.1:3103" || !url.pathname.startsWith("/rest/v1/")) throw Error("FIXTURE_HTTP_SCOPE");
        url.pathname = url.pathname.slice("/rest/v1".length);
        return options!.fetch!(url, init);
      };
      const backend = client(transport, process.env.BCD_HTTP_FIXTURE_TOKEN!, "http://127.0.0.1:3103");
      // Auth has separate physical/deadline proofs; all profile/capability/reader calls here are real HTTP.
      jest.spyOn(backend.auth, "getUser").mockResolvedValue({ data: { user: { id: id("user1") } }, error: null } as Awaited<ReturnType<typeof backend.auth.getUser>>);
      return { ok: true, client: backend };
    });
    const response = await GET(new Request(`http://fixture.invalid/api?${captured}`, { headers: { Authorization: "Bearer synthetic" } }));
    if (response.status !== 200) throw Error(JSON.stringify(await response.json()));
    const buffer = Buffer.from(await response.arrayBuffer()), workbook = xlsx.read(buffer);
    const records = xlsx.utils.sheet_to_json<{ "Visit ID": string }>(workbook.Sheets["Field Visits"]);
    expect(records.map(record => record["Visit ID"])).toEqual(expected);
    expect(records).toHaveLength(expectedCount);
    expect(workbook.SheetNames).toEqual(["Field Visits", "Retailer ERP", "Distributor ERP", "Scope"]);
    expect(response.headers.get("X-Export-Reader-Requests")).toBe(String(Math.ceil(expectedCount / 500) + 2));
    expect(JSON.stringify(xlsx.utils.sheet_to_json(workbook.Sheets.Scope))).toContain("All retained visits");
    console.log(JSON.stringify({ export_ids: records.length, reader_http_requests: Number(response.headers.get("X-Export-Reader-Requests")), authorization_db_http_requests: 2, auth: "synthetic-identity-only", workbook_bytes: buffer.length }));
  }, 15000);
});
