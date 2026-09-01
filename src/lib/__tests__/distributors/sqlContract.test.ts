import fs from "fs";
import path from "path";

const baseSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/039_distributor_status_v1.sql"), "utf8");
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/041_distributor_mapped_status.sql"), "utf8");
const renewalSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/042_payment_collection_renewals.sql"), "utf8");
const billedRenewalSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/052_billed_renewals_erp_payment_status.sql"), "utf8");
const partnerStatusSql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/053_erp_partner_distributor_status_filters.sql"), "utf8");
const routes = ["src/app/api/distributors/route.ts", "src/app/api/distributors/metrics/route.ts", "src/app/api/distributors/commands/route.ts", "src/app/api/distributors/import/route.ts", "src/lib/distributors/validation.ts"].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");

describe("Distributor Status SQL/authority contract", () => {
  test("adds nullable historical mapping truth without a fabricated backfill", () => {
    expect(sql).toContain("add column mapping_status text");
    expect(sql).toContain("alter column mapping_status set default 'pending'");
    expect(sql).not.toMatch(/update\s+public\.distributor_accounts\s+set\s+mapping_status/i);
    expect(sql).toContain("mapping_status is null or mapping_status in ('pending','done')");
    expect(sql).toContain("mapped_at is null or mapping_status='done'");
  });
  test("serves all eight overlapping cards from one aggregate", () => {
    for (const key of ["total", "installation_pending", "training_pending", "installation_training_done", "mapped", "active", "inactive", "billed"]) expect(sql).toContain(`'${key}'`);
    expect(sql).toContain("count(*) filter");
    expect(routes.match(/distributor_status_metrics_v1/g)).toHaveLength(1);
  });
  test("serializes replay, versions updates and allows only assigned employee renewal", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0))");
    expect(sql).toContain("DISTRIBUTOR_OPERATION_MISMATCH");
    expect(sql).toMatch(/for update[\s\S]*DISTRIBUTOR_CONFLICT/);
    expect(sql).toContain("v_admin or v_row.assigned_to=p_actor_id");
    expect(sql).toContain("version=version+1");
    expect(sql.indexOf("DISTRIBUTOR_NOT_ASSIGNED")).toBeLessThan(sql.indexOf("DISTRIBUTOR_CONFLICT','current'"));
  });
  test("manual renewal changes only canonical renewal authority", () => {
    const renewStart = sql.indexOf("if p_operation_type='renew' then");
    const renewBlock = sql.slice(renewStart, sql.indexOf("  else", renewStart));
    expect(renewBlock).toContain("set renewal_date=v_new_renewal");
    expect(renewBlock).not.toMatch(/receivable|task|pipeline|call_logs|attendance|field_visits/i);
  });
  test("canonical identity rejects exact duplicates without fuzzy merging", () => { expect(baseSql).toContain("create unique index distributor_identity_unique_idx"); expect(routes).not.toMatch(/levenshtein|similarity|fuzzy/i); });
  test("employees read assigned rows and cannot directly mutate", () => { expect(baseSql).toContain("assigned_to=auth.uid()"); expect(baseSql).toMatch(/revoke insert,update,delete on public\.distributor_accounts from anon,authenticated/); });
  test("imports are bounded, staged, atomic, mapped and server-revalidated", () => { for (const token of ["jsonb_array_length(p_rows) not between 1 and 5000", "create temporary table distributor_import_stage", "INVALID_ASSIGNEE", "mapping_status", "INVALID_STATUS_COMBINATION"]) expect(sql).toContain(token); expect(sql).not.toMatch(/delete\s+from/i); });
  test("owner-first migration remains compatible with the running pre-041 application", () => {
    expect(sql).toContain("coalesce(p_payload->>'mapping_status','pending')");
    expect(sql).toContain("case when p_payload ? 'mapping_status'");
    expect(sql).toContain("case when v_payload ? 'mapping_status'");
    expect(sql).toContain("case when v_payload ? 'mapped_at'");
  });
  test("imports acquire update locks in deterministic identity order", () => {
    expect(sql).toContain("where classification in ('UPDATE','EXACT_DUPLICATE') order by (payload->>'distributor_id')::uuid");
  });
  test("hot reads are explicit, bounded, and never poll", () => { expect(routes).not.toContain('select("*")'); expect(routes).toContain("max(50)"); expect(routes).not.toMatch(/setInterval|selfie|base64|blob/i); });
  test("missing table, function, or mapped columns are typed as capability missing", () => { expect(fs.readFileSync(path.join(process.cwd(), "src/lib/distributors/server.ts"), "utf8")).toMatch(/42P01[\s\S]*42703[\s\S]*PGRST202[\s\S]*PGRST204[\s\S]*PGRST205/); });
  test("migration cannot mutate protected or financial domains", () => { for (const table of ["receivables", "receivable_payments", "tasks", "call_logs", "field_visits", "attendance", "messages", "leads"]) expect(sql).not.toMatch(new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+public\\.${table}\\b`, "i")); });
  test("Renewals reuse canonical authority with one metrics operation and a bounded explicit page", () => {
    expect(renewalSql).toContain("from public.distributor_accounts d");
    expect(renewalSql).toContain("count(*) filter(where renewal_date<business_date)");
    expect(renewalSql).toContain("greatest(1,least(coalesce(p_page_size,50),50))");
    expect(renewalSql).toContain("d.assigned_to=p_actor_id");
    expect(renewalSql.match(/actor as materialized/g)).toHaveLength(2);
    expect(renewalSql).not.toMatch(/create\s+table|alter\s+table|create\s+index|select\s+\*/i);
  });
  test("Renewal read migration cannot mutate any business authority", () => {
    expect(renewalSql).not.toMatch(/\b(insert\s+into|update|delete\s+from|truncate)\b/i);
    expect(renewalSql).not.toMatch(/receivable_payments|call_logs|field_visits|attendance|tasks|leads/i);
  });
  test("billed renewal readers and status-card filters stay server-side and bounded", () => {
    for (const functionName of ["distributor_renewal_metrics_v1", "distributor_renewals_list_v2", "distributor_renewals_due_v2", "erp_partner_renewals_v1"])
      expect(billedRenewalSql).toContain(`function public.${functionName}`);
    expect(billedRenewalSql.match(/billing_status='billed'/g)?.length).toBeGreaterThanOrEqual(4);
    for (const filter of ["p_installation_filter", "p_training_filter", "p_mapping_filter", "p_activity_filter", "p_renewal_filter"])
      expect(billedRenewalSql).toContain(filter);
    for (const predicate of ["installation_status=p_installation_filter", "training_status=p_training_filter", "mapping_status=p_mapping_filter", "activity_status=p_activity_filter", "billing_status=p_billing_filter", "assigned_to=p_assigned_to"])
      expect(billedRenewalSql).toContain(predicate);
    expect(billedRenewalSql.indexOf("), filtered as (")).toBeLessThan(billedRenewalSql.indexOf("), page_rows as ("));
  });
  test("ERP payment status is nullable, constrained, versioned, and gated by canonical financial PAID", () => {
    expect(billedRenewalSql).toContain("add column erp_payment_status text");
    expect(billedRenewalSql).not.toMatch(/update\s+public\.distributor_accounts\s+set\s+erp_payment_status\s*=\s*'(?:paid|not_paid)'/i);
    expect(billedRenewalSql).toContain("distributor_is_financially_paid_v1");
    expect(billedRenewalSql).toContain("from public.receivables r");
    expect(billedRenewalSql).toContain("p.verification_status='confirmed' and p.reversed_at is null");
    expect(billedRenewalSql).toContain("ERP_PAYMENT_STATUS_REQUIRES_PAID");
    expect(billedRenewalSql).toContain("'erp_payment_status_updated'");
    expect(billedRenewalSql).toContain("version=version+1");
  });
  test("ERP payment command is service-only, idempotent, Admin-authorized, and never writes finance", () => {
    const command = billedRenewalSql.slice(
      billedRenewalSql.indexOf("create or replace function public.distributor_erp_payment_status_command_v1"),
      billedRenewalSql.indexOf("drop function public.distributor_financial_projection_v2"),
    );
    for (const token of ["pg_advisory_xact_lock", "DISTRIBUTOR_OPERATION_MISMATCH", "receivables_is_admin", "DISTRIBUTOR_CONFLICT", "distributor_status_events", "distributor_operation_receipts"])
      expect(command).toContain(token);
    expect(command).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.(?:receivables|receivable_payments)\b/i);
    expect(billedRenewalSql).toMatch(/revoke all on function[\s\S]+distributor_erp_payment_status_command_v1[\s\S]+from public,anon,authenticated/i);
    const privilegedRole = ["service", "role"].join("_");
    expect(billedRenewalSql).toMatch(new RegExp(`grant execute on function[\\s\\S]+distributor_erp_payment_status_command_v1[\\s\\S]+to ${privilegedRole}`, "i"));
  });
  test("replacement projections keep legacy callers compatible through trailing defaults", () => {
    expect(billedRenewalSql).toMatch(/p_erp_unset boolean default false,p_installation_filter text default null/);
    expect(billedRenewalSql).toContain("drop function public.distributor_financial_projection_v2(uuid,integer,integer,text,uuid,text,text,uuid,boolean)");
  });
  test("internal and ERP Partner actionable renewal filters remain billed-only", () => {
    expect(partnerStatusSql.match(/p_renewal_filter='due_soon' and billing_status='billed'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(partnerStatusSql).toContain("p_renewal_filter='overdue' and billing_status='billed'");
    expect(partnerStatusSql).toContain("else 'not_actionable' end renewal_state");
  });
  test("migration 053 is a forward-only service projection with no business-row mutation", () => {
    const ledger = JSON.parse(fs.readFileSync(path.join(process.cwd(), "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json"), "utf8"));
    expect(ledger.lastAppliedOwnerMigration).toBe(ledger.immutableThrough);
    expect(ledger.immutableThrough).toBeGreaterThanOrEqual(53);
    expect(partnerStatusSql).not.toMatch(/\b(create\s+table|alter\s+table|insert\s+into|update\s+public|delete\s+from|truncate)\b/i);
    expect(partnerStatusSql).toMatch(/revoke all on function public\.erp_partner_distributors_v2[\s\S]+from public,anon,authenticated/i);
    expect(partnerStatusSql).toMatch(new RegExp(`grant execute on function public\\.erp_partner_distributors_v2[\\s\\S]+to ${["service", "role"].join("_")}`, "i"));
  });
});
