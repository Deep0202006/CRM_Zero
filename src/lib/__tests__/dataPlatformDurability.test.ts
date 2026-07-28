import fs from "fs";
import path from "path";
import { classifySyncError, nextRetryDelayMs, semanticOperationId } from "../db";

describe("server-authoritative data durability", () => {
  it("derives stable semantic operation IDs", () => {
    expect(semanticOperationId("call_logs", "INSERT", { log_id: "abc" })).toBe("call:abc");
    expect(semanticOperationId("tasks", "UPDATE", { task_id: "t1", status: "Completed" }))
      .toBe("task-completion:t1");
    expect(semanticOperationId("allocated_targets", "UPDATE", { target_id: "x", is_completed: true }))
      .toBe("allocated-target-completion:x");
  });

  it("classifies permanent and retryable failures", () => {
    expect(classifySyncError({ code: "22P02", message: "invalid uuid" }).status).toBe("permanent_failure");
    expect(classifySyncError({ code: "503", message: "temporary server error" }).status).toBe("retry_wait");
  });

  it("uses bounded increasing retry delay without abandoning work", () => {
    expect(nextRetryDelayMs(2)).toBeGreaterThan(nextRetryDelayMs(1));
    expect(nextRetryDelayMs(100)).toBeLessThanOrEqual(15 * 60_000);
  });

  it("migration is enum-safe, immutable, projection-only, and admin-scoped", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "supabase/migrations/030_server_authoritative_data_platform.sql"),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE public.team_activity_events");
    expect(sql).toContain("ON CONFLICT (event_key) DO NOTHING");
    expect(sql).toContain("COALESCE(NEW.problem_status::text, '')");
    expect(sql).toContain("CREATE FUNCTION public.get_team_kpi_daily_v5");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v5(date) FROM PUBLIC, anon");
    expect(sql).not.toMatch(/COALESCE\((?:NEW\.)?(?:status|problem_status),\s*''\)/);
    expect(sql).not.toContain("TRUNCATE TABLE");
  });

  it("logout checks the durable queue before signing out or clearing cache", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/context/AuthContext.tsx"), "utf8");
    expect(source.indexOf("getUnsynchronizedWorkCounts()")).toBeLessThan(source.indexOf("supabase.auth.signOut()"));
    expect(source).toContain("signedOut: false");
  });
});
