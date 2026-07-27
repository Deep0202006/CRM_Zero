import fs from "fs";
import path from "path";

describe("Team KPI database migration", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/026_team_kpi_repair.sql"),
    "utf8",
  );

  it("uses one secure authoritative aggregation over the real work tables", () => {
    for (const required of [
      "CREATE OR REPLACE FUNCTION public.get_team_kpi_daily(target_date date)",
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public",
      "auth.uid()",
      "public.user_capabilities",
      "capability_code = 'admin'",
      "public.tasks",
      "public.task_status_history",
      "public.allocated_targets",
      "public.call_logs",
      "public.client_queries",
      "public.mapping_requests",
      "Asia/Kolkata",
      "position('→' IN COALESCE(c.outcome, '')) = 0",
      "ADD COLUMN IF NOT EXISTS requested_by",
      "history.new_status = 'Completed'",
      "target.is_completed = true",
      "REVOKE ALL ON FUNCTION",
      "GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily(date) TO authenticated",
    ]) {
      expect(sql).toContain(required);
    }
  });

  it("does not repeat the known broken dependencies or destructive data operations", () => {
    for (const forbidden of [
      "u.role",
      "public.has_capability",
      "kpi_daily_snapshot",
      "TRUNCATE",
      "DROP TABLE",
      "DELETE FROM public",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});
