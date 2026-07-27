import fs from "fs";
import path from "path";

describe("Team KPI migration 027", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/027_team_kpi_live_data_repair.sql"), "utf8");

  it("installs a secure single-RPC contract without altering business tables", () => {
    for (const required of [
      "CREATE OR REPLACE FUNCTION public.get_team_kpi_daily(target_date date)",
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public",
      "capability_code = 'admin'",
      "Asia/Kolkata",
      "count(DISTINCT c.log_id)",
      "count(DISTINCT q.query_id)",
      "count(DISTINCT m.request_id)",
      "DISTINCT ON (h.task_id)",
      "public.allocated_targets",
      "idx_call_logs_kpi_timestamp_user",
      "idx_allocated_targets_kpi_completed_at_user",
      "ALTER PUBLICATION supabase_realtime ADD TABLE",
      "REVOKE ALL ON FUNCTION public.get_team_kpi_daily(date) FROM PUBLIC",
      "GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily(date) TO authenticated",
    ]) expect(sql).toContain(required);

    for (const forbidden of ["TRUNCATE", "DELETE FROM", "DROP TABLE", "SERVICE_ROLE", "u.role", "kpi_daily_snapshot"]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});
