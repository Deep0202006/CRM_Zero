import fs from "fs";
import path from "path";

describe("Team KPI server API contract", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/team-kpi/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/manager/kpi/page.tsx"), "utf8");

  it("validates the caller session and delegates authorization to the admin-only RPC", () => {
    expect(route).toContain("userClient.auth.getUser(accessToken)");
    expect(route).toContain('userClient.rpc("get_team_kpi_daily_v5"');
    expect(route).toContain("ADMIN_REQUIRED");
  });

  it("has no service-role or raw-table aggregation fallback", () => {
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(route).not.toContain("createServiceClient");
    expect(route).not.toContain("loadTeamKpiServerReport");
  });

  it("returns explicit deployment and source failures instead of an empty dashboard", () => {
    expect(route).toContain("TEAM_KPI_V5_NOT_INSTALLED");
    expect(route).toContain("TEAM_KPI_DATABASE_FAILED");
    expect(route).toContain("TEAM_KPI_NO_ACTIVE_USERS");
  });

  it("keeps the existing page and uses one authenticated API request", () => {
    expect(page).toContain("/api/team-kpi?date=");
    expect(page).not.toContain('supabase.rpc("get_team_kpi_daily');
    expect(page).toContain("AbortController");
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) {
      expect(page).toContain(label);
    }
  });
});
