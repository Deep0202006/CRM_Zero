import fs from "fs";
import path from "path";

describe("Team KPI page data path", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/manager/kpi/page.tsx"),
    "utf8",
  );

  it("uses one authenticated server API request instead of browser-side raw aggregation", () => {
    expect(source).toContain('fetch("/api/team-kpi"');
    expect(source).toContain("supabase.auth.getSession()");
    for (const forbidden of [
      'supabase.rpc("get_team_kpi_daily',
      'supabase.from("users")',
      'supabase.from("tasks")',
      'supabase.from("call_logs")',
      'supabase.from("client_queries")',
      'supabase.from("mapping_requests")',
      "kpi_snapshots",
      "kpi_daily_snapshot",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("refreshes from confirmed work sources with one debounced API reload and no polling", () => {
    for (const table of [
      "call_logs",
      "tasks",
      "task_status_history",
    ]) {
      expect(source).toContain(`"${table}"`);
    }
    expect(source).not.toContain('"team_work_events"');
    expect(source).toContain("setTimeout");
    expect(source).toContain("350");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain('type="date"');
    expect(source).not.toContain('aria-label="KPI date"');
  });

  it("keeps all four requested work metrics visible", () => {
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) {
      expect(source).toContain(label);
    }
  });

  it("keeps visual intelligence prop-only and truthful", () => {
    const component = fs.readFileSync(path.join(process.cwd(), "src/components/analytics/TeamKpiIntelligence.tsx"), "utf8");
    expect(component).toContain("ContributionRing");
    expect(component).toContain("KpiRadarProfile");
    expect(component).toContain("No historical trend is implied");
    expect(component).not.toMatch(/fetch\(|supabase|setInterval|\.from\(/);
  });
});
