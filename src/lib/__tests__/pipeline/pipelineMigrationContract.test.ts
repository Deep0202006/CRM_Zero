import fs from "node:fs";
import path from "node:path";

describe("Pipeline migration contract", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/032_pipeline_authoritative_transitions.sql"), "utf8");
  test("adds Renewal Due without rewriting leads and never references missing updated_at", () => { expect(sql).toContain("add value if not exists 'Renewal Due'"); expect(sql).not.toContain("updated_at"); });
  test("owner, optimistic concurrency, employee matrix and idempotency are server enforced", () => {
    expect(sql).toContain("operation_id uuid primary key"); expect(sql).toContain("v_lead.assigned_to is distinct from p_actor_id");
    expect(sql).toContain("v_lead.status::text <> p_expected_stage"); expect(sql).toContain("pg_advisory_xact_lock"); expect(sql).not.toContain("('Payment','Renewal Due')");
  });
  test("the confirmed status trigger owns stage_entered_at", () => { expect(sql).toContain("new.stage_entered_at = now()"); expect(sql).toContain("trg_lead_stage_change"); });
  test("direct authenticated status writes and old RPC access are blocked", () => { expect(sql).toContain("guard_pipeline_employee_status_write"); expect(sql).toContain("from public, anon, authenticated"); });
  test("existing lead rows are not deleted or mass normalized", () => { expect(sql).not.toMatch(/delete\s+from\s+public\.leads/i); expect(sql).not.toMatch(/update\s+public\.leads\s+set\s+status\s*=\s*case/i); });
});
