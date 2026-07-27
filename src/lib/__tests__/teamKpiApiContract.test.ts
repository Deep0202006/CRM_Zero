import fs from "fs";
import path from "path";

describe("Team KPI server API contract", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/team-kpi/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/manager/kpi/page.tsx"), "utf8");

  it("authenticates and authorizes an administrator on the server", () => {
    expect(route).toContain("client.auth.getUser(accessToken)");
    expect(route).toContain('.from("user_capabilities")');
    expect(route).toContain('entry.capability_code === "admin"');
    expect(route).not.toContain("SERVICE_ROLE");
  });

  it("requires the durable ledger RPC and never hides its failure behind an RLS-limited raw-table fallback", () => {
    expect(route).toContain('client.rpc("get_team_kpi_daily_v3"');
    expect(route).toContain("TEAM_KPI_LEDGER_NOT_INSTALLED");
    expect(route).toContain("TEAM_KPI_DATABASE_FAILED");
    expect(route).not.toContain("loadTeamKpiServerReport");
    expect(route).not.toContain('client.rpc("get_team_kpi_daily"');
  });

  it("returns a diagnostic error rather than an empty report when active users disappear", () => {
    expect(route).toContain('client.rpc("get_team_kpi_health_v1"');
    expect(route).toContain("TEAM_KPI_NO_ACTIVE_USERS");
  });

  it("keeps the existing page and uses one authenticated API request", () => {
    expect(page).toContain("/api/team-kpi?date=");
    expect(page).not.toContain('supabase.rpc("get_team_kpi_daily"');
    expect(page).toContain("60_000");
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) expect(page).toContain(label);
  });
});
