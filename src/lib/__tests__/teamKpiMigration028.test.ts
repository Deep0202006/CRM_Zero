import fs from "fs";
import path from "path";

describe("Team KPI durable event-ledger migration 028", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/028_team_kpi_event_ledger.sql"),
    "utf8",
  );

  it("creates one idempotent work ledger and a v3 admin-only report", () => {
    for (const required of [
      "CREATE TABLE IF NOT EXISTS public.team_work_events",
      "event_key text NOT NULL UNIQUE",
      "business_date date NOT NULL",
      "CREATE OR REPLACE FUNCTION public.get_team_kpi_daily_v3(target_date date)",
      "CREATE OR REPLACE FUNCTION public.get_team_kpi_health_v1(target_date date)",
      "capability.capability_code = 'admin'",
      "SET search_path = pg_catalog, public",
      "REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v3(date) FROM PUBLIC",
      "GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily_v3(date) TO authenticated",
      "'source', 'team-work-events'",
      "'schema_version', 3",
    ]) expect(sql).toContain(required);
  });

  it("captures and backfills every requested authoritative work source", () => {
    for (const source of [
      "team_kpi_capture_call_log",
      "team_kpi_capture_client_query",
      "team_kpi_capture_mapping_request",
      "team_kpi_capture_task_history",
      "team_kpi_capture_task",
      "team_kpi_capture_allocated_target",
      "'call:' || call_log.log_id::text",
      "'query:' || query.query_id::text",
      "'mapping:' || mapping.request_id::text",
      "'task-history:' || history.id::text",
      "'target:' || target.target_id::text",
    ]) expect(sql).toContain(source);
  });

  it("is additive and does not remove operational or historical business records", () => {
    for (const forbidden of [
      "DROP TABLE public.call_logs",
      "DROP TABLE public.client_queries",
      "DROP TABLE public.mapping_requests",
      "DROP TABLE public.tasks",
      "TRUNCATE public.",
      "DELETE FROM public.call_logs",
      "DELETE FROM public.client_queries",
      "DELETE FROM public.mapping_requests",
      "DELETE FROM public.tasks",
    ]) expect(sql).not.toContain(forbidden);
  });
});
