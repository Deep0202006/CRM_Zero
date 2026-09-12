/** @jest-environment node */
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/team-kpi/route";
import { createServerAnonClient, createServerServiceClient } from "../serverBackendEnvironment";
import { loadTeamKpiHistory } from "../teamKpi/historyServer";

jest.mock("../serverBackendEnvironment", () => ({ createServerAnonClient: jest.fn(), createServerServiceClient: jest.fn(), backendUnavailableResponse: () => Response.json({}, { status: 503 }) }));
jest.mock("../teamKpi/historyServer", () => ({ loadTeamKpiHistory: jest.fn() }));

describe("Team KPI server API contract", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/team-kpi/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/manager/kpi/page.tsx"), "utf8");
  it("authenticates an active administrator", () => { expect(route).toContain("userClient.auth.getUser(token)"); expect(route).toContain("await isAdmin(service, data.user.id, resource)"); expect(route).toContain("ADMIN_REQUIRED"); });
  it("uses only canonical service-side aggregation", () => { expect(route).toContain("createServerServiceClient"); expect(route).toContain("loadTeamKpiServerReport(service"); expect(route).not.toContain('.rpc("get_team_kpi_daily'); });
  it("fails explicitly instead of returning fake zeros", () => { expect(route).toContain("backendUnavailableResponse"); expect(route).toContain("TEAM_KPI_SERVER_ERROR"); expect(route).toContain("TEAM_KPI_NO_ACTIVE_USERS"); });
  it("keeps one authenticated page request, existing realtime, and zero polling", () => { expect(page).toContain('fetch("/api/team-kpi"'); expect(page).not.toContain('supabase.rpc("get_team_kpi_daily'); expect(page).not.toContain("setInterval"); expect(page).toContain("supabase.channel"); });
  it("preserves Today while gating its readers away from History", () => { expect(route).toContain("const targetDate = getCurrentISTDate()"); expect(route).toContain("parseHistoryScope(request.nextUrl.searchParams"); expect(page).toContain('reportMode !== "today"'); expect(page).toContain("requestSequence.current += 1"); });
});

describe("Team history route authorization", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  function setup(active = true, capabilities = ["admin"], authenticated = true) {
    jest.mocked(createServerAnonClient).mockReturnValue({ ok: true, client: { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: authenticated ? { id: userId } : null }, error: null }) } } } as unknown as ReturnType<typeof createServerAnonClient>);
    const from = jest.fn((table: string) => {
      const data = table === "users" ? [{ user_id: userId, is_active: active }] : capabilities.map((capability_code) => ({ capability_code }));
      const chain = { select: () => chain, eq: () => chain, limit: () => chain, setHeader: () => chain, retry: () => chain, abortSignal: () => chain, maybeSingle: async () => ({ data: data[0] }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data })) };
      return chain;
    });
    jest.mocked(createServerServiceClient).mockReturnValue({ ok: true, client: { from, auth: { getUser: jest.fn().mockResolvedValue({ data: { user: authenticated ? { id: userId } : null }, error: null }) } } } as unknown as ReturnType<typeof createServerServiceClient>);
    jest.mocked(loadTeamKpiHistory).mockResolvedValue({ kind: "test-history" } as unknown as Awaited<ReturnType<typeof loadTeamKpiHistory>>);
    return from;
  }
  beforeEach(() => jest.clearAllMocks());
  const request = (query = "from=2026-09-07&to=2026-09-08", bearer = true) => new NextRequest(`http://localhost/api/team-kpi?${query}`, { headers: bearer ? { authorization: "Bearer fixture" } : {} });
  it("requires authentication before any service reads", async () => {
    const from = setup();
    expect((await GET(request(undefined, false))).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    setup(true, ["admin"], false);
    expect((await GET(request())).status).toBe(401);
    expect(loadTeamKpiHistory).not.toHaveBeenCalled();
  });
  it("requires an active admin even for malformed ranges", async () => {
    for (const [active, caps] of [[false, ["admin"]], [true, ["ret_support"]]] as const) {
      setup(active, [...caps]);
      expect((await GET(request("from=bad"))).status).toBe(403);
    }
    expect(loadTeamKpiHistory).not.toHaveBeenCalled();
  });
  it("validates range before reader entry and sends only the parsed authorized scope", async () => {
    setup();
    expect((await GET(request("from=bad"))).status).toBe(400);
    expect(loadTeamKpiHistory).not.toHaveBeenCalled();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(loadTeamKpiHistory).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ from: "2026-09-07", to: "2026-09-08", employee: null }), expect.any(String), expect.objectContaining({ read: expect.any(Function), fetch: expect.any(Function) }));
  });
});
