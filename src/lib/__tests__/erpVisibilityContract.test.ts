import fs from "node:fs";
import path from "node:path";
import {
  normalizeErpKey,
  normalizeErpName,
  stableErpId,
} from "@/lib/erp/domain";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");
const migration = read(
  "supabase/migrations/047_distributor_erp_partner_visibility.sql",
);
const paymentStatusMigration = read(
  "supabase/migrations/052_billed_renewals_erp_payment_status.sql",
);
const statusFilterMigration = read(
  "supabase/migrations/053_erp_partner_distributor_status_filters.sql",
);

describe("CRM-P1-047 ERP authority and external-view contract", () => {
  test("normalizes Unicode, case, and whitespace to one deterministic ERP identity", () => {
    expect(normalizeErpName("  MARG\u00a0  ERP ")).toBe("MARG ERP");
    expect(normalizeErpKey("  MARG\u00a0  ERP ")).toBe("marg erp");
    expect(stableErpId(" MARG ")).toBe(stableErpId("marg"));
    expect(stableErpId("MARG")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("keeps ERP canonical on Distributor Status and joins readers without financial duplication", () => {
    expect(migration).toContain("create table public.erp_systems");
    expect(migration).toMatch(
      /alter table public\.distributor_accounts\s+add column erp_id uuid/i,
    );
    expect(migration).toContain("on delete restrict");
    expect(migration).toContain("receivables_financial_read_v2");
    expect(migration).toContain("authority.distributor_id");
    expect(migration).not.toMatch(
      /alter table public\.receivables\s+add column erp/i,
    );
    expect(migration).not.toMatch(
      /alter table public\.receivable_payments\s+add column erp/i,
    );
  });

  test("enforces exclusive external capability, exact scopes, and service-only reads", () => {
    for (const invariant of [
      "ERP_PARTNER_CAPABILITY_EXCLUSIVE",
      "ERP_PARTNER_ACTIVE_ASSIGNMENTS",
      "is_operational_employee_v1",
      "erp_partner_distributors_v1",
      "erp_partner_renewals_v1",
    ])
      expect(migration).toContain(invariant);
    expect(migration).toMatch(
      /revoke all on public\.erp_partner_scopes from public,anon,authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function[\s\S]+erp_partner_distributors_v1[\s\S]+to service_role/i,
    );
    const externalProjection = migration.slice(
      migration.indexOf(
        "create or replace function public.erp_partner_distributors_v1",
      ),
      migration.indexOf(
        "create or replace function public.erp_partner_renewals_v1",
      ),
    );
    for (const forbidden of [
      "bill_amount",
      "outstanding_amount",
      "receivable_id",
      "payment_reference",
      "assigned_to",
      "lead_id",
    ])
      expect(externalProjection).not.toContain(forbidden);
  });

  test("dedicated pages are read-only and internal APIs deny external viewer contexts", () => {
    const layout = read("src/components/DashboardLayout.tsx");
    expect(layout).toContain('path: "/erp/distributors"');
    expect(layout).toContain('path: "/erp/renewals"');
    expect(layout).toContain("isErpPartnerViewer");
    expect(layout).toContain('router.replace("/erp/distributors")');
    expect(read("src/lib/receivables/server.ts")).toContain(
      "INTERNAL_ACCESS_DENIED",
    );
    for (const route of [
      "src/app/api/distributors/route.ts",
      "src/app/api/distributors/commands/route.ts",
      "src/app/api/receivables/route.ts",
      "src/app/api/receivables/commands/route.ts",
    ])
      expect(read(route)).toContain("externalViewerDenied");
  });

  test("scoped ERP Partner readers receive only the operational ERP payment status and billed renewals", () => {
    const distributorProjection = paymentStatusMigration.slice(
      paymentStatusMigration.indexOf("create or replace function public.erp_partner_distributors_v1"),
      paymentStatusMigration.indexOf("create or replace function public.erp_partner_renewals_v1"),
    );
    expect(distributorProjection).toContain("d.erp_payment_status");
    for (const forbidden of ["bill_amount", "outstanding_amount", "receivable_id", "payment_reference", "assigned_to", "lead_id"])
      expect(distributorProjection).not.toContain(forbidden);
    const renewalProjection = paymentStatusMigration.slice(paymentStatusMigration.indexOf("create or replace function public.erp_partner_renewals_v1"));
    expect(renewalProjection).toContain("d.billing_status='billed'");
  });

  test("external sessions skip attendance verification and every internal sync queue", () => {
    const auth = read("src/context/AuthContext.tsx");
    const layout = read("src/components/DashboardLayout.tsx");
    expect(auth).toContain("if (!externalViewer && navigator.onLine)");
    expect(auth).toMatch(/if \(!externalViewer\)\s+pullDownSync\(\)/);
    expect(auth).toContain("!externalViewer");
    expect(layout).toMatch(/pathname === "\/login"\s*\|\|\s*isErpPartnerViewer/);
    expect(layout).toContain("!isErpPartnerViewer && (");
  });

  test("serves full-scope ERP status metrics and filters before bounded pagination", () => {
    const projection = statusFilterMigration.slice(statusFilterMigration.indexOf("create function public.erp_partner_distributors_v2"));
    for (const key of ["total", "installation_pending", "training_pending", "not_billed", "active", "billed", "paid", "renewal_due_soon", "renewal_overdue"])
      expect(projection).toContain(`'${key}'`);
    expect(projection).toContain("installation_status='done' and training_status='pending'");
    expect(projection).toContain("erp_payment_status='paid'");
    expect(projection).toMatch(/billing_status='billed' and renewal_date between business_date and business_date\+2/);
    expect(projection.indexOf("), metrics as (")).toBeLessThan(projection.indexOf("), filtered as ("));
    expect(projection.indexOf("), filtered as (")).toBeLessThan(projection.indexOf("), page_rows as ("));
    expect(projection).toContain("least(50,greatest(1,coalesce(p_page_size,50)))");
  });

  test("keeps the external projection private and the UI dependent on server metrics", () => {
    const projection = statusFilterMigration.slice(statusFilterMigration.indexOf("create function public.erp_partner_distributors_v2"));
    for (const forbidden of ["bill_amount", "outstanding_amount", "receivable_id", "payment_reference", "assigned_to", "lead_id", "notes"])
      expect(projection).not.toContain(forbidden);
    const page = read("src/components/erpPartner/ErpPartnerDistributorsPage.tsx");
    expect(page).not.toContain("rows.filter");
    expect(page).not.toContain('["Mapped"');
    expect(page).toContain("mapping_status");
    expect(page).toContain("aria-pressed");
    expect(page).toContain("result.metrics");
  });
});
