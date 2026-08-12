import fs from "node:fs";
import path from "node:path";

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8");

describe("Pipeline authority and correction migrations", () => {
  const authority = read("037_pipeline_authority_and_resource_budget.sql");
  const correction = read("038_retailer_payment_to_converted.sql");

  test("never deletes leads or other business history", () => {
    const sql = `${authority}\n${correction}`;
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/drop\s+table/i);
  });

  test("removes both Pipeline task generators before the exact correction", () => {
    expect(authority).toContain("drop trigger if exists trg_lead_followup_task");
    expect(authority).toContain("drop trigger if exists trg_init_registration_checklist");
    expect(authority).toContain("drop function if exists public.create_followup_task_on_stage_change()");
    expect(authority).toContain("drop function if exists public.init_registration_checklist()");
    expect(authority).toContain("drop function if exists public.surface_reengagement_leads()");
    expect(authority).toContain("drop function if exists public.process_renewals(date)");
    expect(authority).not.toMatch(/insert\s+into\s+public\.tasks/i);
    expect(correction).not.toMatch(/public\.(tasks|call_logs|field_visits|receivables|receivable_payments|chat_messages)/i);
  });

  test("archives only proven active Pipeline work without changing completed or ambiguous tasks", () => {
    expect(authority).toContain("set is_active = false");
    expect(authority).toContain("status::text in ('Pending','In Progress')");
    expect(authority).toContain("description = 'Required for registration.'");
    expect(authority).toContain("description ~ '^Lead moved to");
    expect(authority).toContain("cancellation_reason = 'pipeline_automatic_work_removed'");
  });

  test("active users read globally while owner authority applies to ordinary writes", () => {
    expect(authority).toContain('create policy "Active users read Pipeline"');
    expect(authority).toContain('create policy "Owners update own leads"');
    expect(authority).toContain("assigned_to = auth.uid()");
    expect(authority).not.toMatch(/is_admin|role\s*=\s*'Admin'/i);
  });

  test("RPC derives owner and segment rules and has no cross-domain write", () => {
    expect(authority).toContain("v_lead.assigned_to is distinct from p_actor_id");
    expect(authority).toContain("v_lead.segment_type::text = 'Retailer'");
    expect(authority).toContain("'PIPELINE_RETAILER_PAYMENT_FORBIDDEN'");
    expect(authority).toContain("v_lead.segment_type::text = 'Distributor'");
    expect(authority).not.toMatch(/insert\s+into\s+public\.(tasks|call_logs|field_visits|receivables|receivable_payments|chat_messages)/i);
  });

  test("correction targets only Retailer Payment and records a system audit", () => {
    expect(correction).toMatch(/update\s+public\.leads\s+set\s+status\s*=\s*'Converted'/i);
    expect(correction).toContain("where segment_type::text = 'Retailer' and status::text = 'Payment'");
    expect(correction).toContain("'system_correction','retailer_payment_stage_removed'");
    expect(correction).not.toContain("segment_type::text = 'Distributor'");
  });

  test("analytics use segment-specific terminal stages without relational rewrites", () => {
    expect(authority).toContain("segment_type::text='Retailer' and status::text='Converted'");
    expect(authority).toContain("segment_type::text='Distributor' and status::text='Payment'");
    expect(authority).toContain("security_invoker=true");
  });
});
