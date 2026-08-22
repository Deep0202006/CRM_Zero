import fs from "fs";
import path from "path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Distributor ERP footprint", () => {
  it("extends the existing metrics aggregate with canonical Distributor ERP only", () => {
    const migration = read("supabase/migrations/050_distributor_erp_footprint.sql");
    expect(migration).toContain("create or replace function public.distributor_status_metrics_v1(p_actor_id uuid,p_admin boolean)");
    for (const key of ["total", "installation_pending", "training_pending", "installation_training_done", "mapped", "active", "inactive", "billed"])
      expect(migration).toContain(`'${key}'`);
    expect(migration).toContain("'erp_distribution'");
    expect(migration).toContain("public.distributor_accounts");
    expect(migration).toContain("public.erp_systems");
    expect(migration).toContain("d.erp_id");
    expect(migration).not.toMatch(/field_visits|field_business_erp_baselines|field_visit_erp_intelligence|field_business_erp_current/i);
    expect(migration).not.toMatch(/\b(insert|update|delete)\s+(into\s+)?public\.(distributor_accounts|erp_systems|field_visits|receivables|receivable_payments|leads)/i);
  });

  it("reuses the shared ERP donut without a new page fetch or Recharts implementation", () => {
    const page = read("src/app/admin/payments/distributors/page.tsx");
    const shared = read("src/components/analytics/ErpDistributionDonut.tsx");
    expect(page).toContain("/api/distributors/metrics");
    expect(page).toContain("ErpDistributionDonut");
    expect(page).not.toMatch(/from\s+["']recharts["']/);
    expect(page).not.toMatch(/PieChart|stableErpColor|\/api\/distributors\/erp-analytics/);
    expect(shared).toMatch(/PieChart/);
    expect(shared).toMatch(/stableErpColor/);
  });

  it("keeps visit-specific ERP states, reconciliation, accessibility, and stable colors in the shared presentation", () => {
    const visit = read("src/components/analytics/FieldVisitErpIntelligence.tsx");
    const shared = read("src/components/analytics/ErpDistributionDonut.tsx");
    expect(visit).toMatch(/"none" \| "not_captured"/);
    expect(visit).toContain('byState("none")');
    expect(visit).toContain('byState("not_captured")');
    expect(visit).toContain("reconciled");
    expect(shared).toContain("accessibilityLayer");
    expect(shared).toContain("stableErpColor");
  });
});
