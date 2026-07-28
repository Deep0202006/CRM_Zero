import fs from "fs";
import path from "path";

describe("Team KPI source and sync repair migration 029", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/029_team_kpi_source_sync_repair.sql"),
    "utf8",
  );

  it("repairs call source storage and installs the admin-only v4 report", () => {
    for (const required of [
      "ADD COLUMN IF NOT EXISTS client_username",
      "ADD COLUMN IF NOT EXISTS client_name",
      "ALTER COLUMN lead_id DROP NOT NULL",
      "CREATE OR REPLACE FUNCTION public.get_team_kpi_daily_v4(p_target_date date)",
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public",
      "capability_code = 'admin'",
      "Asia/Kolkata",
      "public.call_logs",
      "public.client_queries",
      "public.mapping_requests",
      "public.mappings",
      "public.task_status_history",
      "public.tasks",
      "public.allocated_targets",
      "REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v4(date) FROM PUBLIC",
      "GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily_v4(date) TO authenticated",
    ]) {
      expect(sql).toContain(required);
    }
  });

  it("includes active zero-work users and does not depend on the Activity Deck or snapshots", () => {
    expect(sql).toContain("FROM public.users team_user");
    expect(sql).toContain("LEFT JOIN event_totals");
    expect(sql).not.toContain("activity_deck");
    expect(sql).not.toContain("kpi_daily_snapshot");
    expect(sql).not.toContain("FROM public.team_work_events");
    expect(sql).not.toContain("INSERT INTO public.team_work_events");
  });

  it("supports the repository's integer or boolean active-user schema", () => {
    expect(sql).toContain("is_active::text");
    expect(sql).toContain("IN ('1', 'true', 't')");
    expect(sql).not.toContain("COALESCE(team_user.is_active, true)");
  });

  it("retires the obsolete ledger triggers without deleting retained ledger history", () => {
    for (const trigger of [
      "team_kpi_call_log_event",
      "team_kpi_client_query_event",
      "team_kpi_mapping_request_event",
      "team_kpi_task_history_event",
      "team_kpi_task_event",
      "team_kpi_allocated_target_event",
    ]) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    expect(sql).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.team_work_events");
  });

  it("does not delete retained business records", () => {
    for (const forbidden of [
      "DELETE FROM public.call_logs",
      "DELETE FROM public.client_queries",
      "DELETE FROM public.mapping_requests",
      "DELETE FROM public.tasks",
      "TRUNCATE public.",
      "DROP TABLE IF EXISTS public.call_logs",
      "DROP TABLE IF EXISTS public.client_queries",
      "DROP TABLE IF EXISTS public.mapping_requests",
      "DROP TABLE IF EXISTS public.tasks",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});
