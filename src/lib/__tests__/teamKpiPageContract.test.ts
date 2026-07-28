import fs from "fs";
import path from "path";

describe("Team KPI page data path", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/manager/kpi/page.tsx"),
    "utf8",
  );

  it("uses one authenticated server API request instead of browser-side raw aggregation", () => {
    expect(source).toContain("/api/team-kpi?date=");
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

  it("refreshes from the normalized projection with one debounced API reload", () => {
    for (const table of [
      "team_activity_events",
      "users",
      "user_capabilities",
    ]) {
      expect(source).toContain(`"${table}"`);
    }
    for (const table of ["call_logs", "client_queries", "mapping_requests", "tasks", "allocated_targets"]) {
      expect(source).not.toContain(`"${table}"`);
    }
    expect(source).toContain("setTimeout");
    expect(source).toContain("750");
    expect(source).toContain("AbortController");
  });

  it("keeps all four requested work metrics visible", () => {
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) {
      expect(source).toContain(label);
    }
  });
});
