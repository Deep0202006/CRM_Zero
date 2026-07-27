import fs from "fs";
import path from "path";

describe("Team KPI page data path", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/manager/kpi/page.tsx"),
    "utf8",
  );

  it("uses the single server KPI function instead of browser-side raw aggregation", () => {
    expect(source).toContain('supabase.rpc("get_team_kpi_daily"');
    for (const forbidden of [
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

  it("refreshes from the authoritative RPC after all relevant source-table events", () => {
    for (const table of [
      "task_status_history",
      "allocated_targets",
      "call_logs",
      "client_queries",
      "mapping_requests",
    ]) {
      expect(source).toContain(`"${table}"`);
    }
    expect(source).toContain("setTimeout");
    expect(source).toContain("750");
  });

  it("keeps all four requested work metrics visible", () => {
    for (const label of ["Calls", "Client queries", "Mappings", "Tasks done"]) {
      expect(source).toContain(label);
    }
  });
});
