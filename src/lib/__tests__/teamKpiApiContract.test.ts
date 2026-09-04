import fs from "fs";
import path from "path";

describe("Team KPI server API contract", () => {
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/team-kpi/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/manager/kpi/page.tsx"), "utf8");
  it("authenticates an active administrator", () => { expect(route).toContain("userClient.auth.getUser(token)"); expect(route).toContain("await isAdmin(service, data.user.id)"); expect(route).toContain("ADMIN_REQUIRED"); });
  it("uses only canonical service-side aggregation", () => { expect(route).toContain("createServerServiceClient"); expect(route).toContain("loadTeamKpiServerReport(service"); expect(route).not.toContain('.rpc("get_team_kpi_daily'); });
  it("fails explicitly instead of returning fake zeros", () => { expect(route).toContain("SUPABASE_NOT_CONFIGURED"); expect(route).toContain("TEAM_KPI_SERVER_ERROR"); expect(route).toContain("TEAM_KPI_NO_ACTIVE_USERS"); });
  it("keeps one authenticated page request, existing realtime, and zero polling", () => { expect(page).toContain('fetch("/api/team-kpi"'); expect(page).not.toContain('supabase.rpc("get_team_kpi_daily'); expect(page).not.toContain("setInterval"); expect(page).toContain("supabase.channel"); });
  it("is today-only", () => { expect(route).toContain("const targetDate = getCurrentISTDate()"); expect(route).not.toContain('searchParams.get("date")'); expect(page).not.toContain('type="date"'); });
});
