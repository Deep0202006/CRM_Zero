import fs from "fs";
import path from "path";

describe("Team KPI server API contract", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/team-kpi/route.ts"), "utf8");
  const serverReport = fs.readFileSync(path.join(process.cwd(), "src/lib/teamKpi/serverReport.ts"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/manager/kpi/page.tsx"), "utf8");

  it("authenticates and authorizes an administrator on the server", () => {
    expect(route).toContain("client.auth.getUser(accessToken)");
    expect(route).toContain('.from("user_capabilities")');
    expect(route).toContain('entry.capability_code === "admin"');
    expect(route).not.toContain("SERVICE_ROLE");
  });

  it("prefers the secure database aggregate and keeps a server-only fallback", () => {
    expect(route).toContain("const rpcReport = await tryDatabaseRpc");
    expect(route).toContain("loadTeamKpiServerReport");
    expect(route.indexOf("tryDatabaseRpc")).toBeLessThan(route.indexOf("loadTeamKpiServerReport(client"));
  });

  it("uses paginated source reads and India day bounds", () => {
    expect(serverReport).toContain("PAGE_SIZE = 1000");
    expect(serverReport).toContain("fetchAllPages");
    expect(serverReport).toContain("T00:00:00+05:30");
    for (const source of ["call_logs", "client_queries", "mapping_requests", "tasks", "task_status_history", "allocated_targets"]) {
      expect(serverReport).toContain(`.from("${source}")`);
    }
    expect(serverReport).toContain("fetchTasksByIds");
  });

  it("keeps the existing page and replaces the fragile direct RPC dependency with one API call", () => {
    expect(page).toContain("/api/team-kpi?date=");
    expect(page).not.toContain('supabase.rpc("get_team_kpi_daily"');
    expect(page).toContain("60_000");
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) expect(page).toContain(label);
  });
});
