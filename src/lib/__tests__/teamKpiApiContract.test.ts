import fs from "fs";
import path from "path";

describe("Team KPI server API contract", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/team-kpi/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/manager/kpi/page.tsx"), "utf8");

  it("validates the caller session and delegates authorization to the admin-only RPC", () => {
    expect(route).toContain("userClient.auth.getUser(accessToken)");
    expect(route).toContain("await verifyAdmin(authorizationClient, userData.user.id)");
    expect(route).toContain('userClient.rpc("get_team_kpi_daily_v4"');
    expect(route).toContain("ADMIN_REQUIRED");
  });

  it("uses a server-only service client as a controlled raw-source fallback", () => {
    expect(route).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(route).toContain("createServiceClient");
    expect(route).toContain("loadTeamKpiServerReport(serviceClient");
    expect(route).toContain("const authorizationClient = serviceClient ?? userClient");
    expect(route).toContain("isActiveUserValue");
    expect(route).not.toContain("loadTeamKpiServerReport(userClient");
  });

  it("returns explicit deployment and source failures instead of an empty dashboard", () => {
    expect(route).toContain("TEAM_KPI_V4_NOT_INSTALLED");
    expect(route).toContain("TEAM_KPI_DATABASE_FAILED");
    expect(route).toContain("TEAM_KPI_NO_ACTIVE_USERS");
  });

  it("keeps the existing page and uses one authenticated API request", () => {
    expect(page).toContain('fetch("/api/team-kpi"');
    expect(page).not.toContain('supabase.rpc("get_team_kpi_daily');
    expect(page).not.toContain("setInterval");
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) {
      expect(page).toContain(label);
    }
  });

  it("always uses today's India business date and exposes no historical control", () => {
    expect(route).toContain("const targetDate = getCurrentISTDate()");
    expect(route).not.toContain('searchParams.get("date")');
    expect(page).toContain("const todayDate = getCurrentISTDate()");
    expect(page).not.toContain('type="date"');
  });
});
