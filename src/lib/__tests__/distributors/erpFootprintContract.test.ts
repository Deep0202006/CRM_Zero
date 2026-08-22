import fs from "fs";
import path from "path";
import { erpDistributionLabel, erpDistributionReconciles } from "@/components/analytics/ErpDistributionDonut";

const contextForMock = jest.fn();
const rpcMock = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/distributors/server", () => ({
  contextFor: (...args: unknown[]) => contextForMock(...args),
  apiError: (status: number, code: string, message: string) => Response.json({ code, message }, { status }),
  distributorReadError: () => Response.json({ code: "DISTRIBUTOR_SERVER_ERROR" }, { status: 503 }),
  externalViewerDenied: () => null,
}));
jest.mock("@/lib/employees/server", () => ({ listEligibleOperationalEmployees: () => Promise.resolve({ employees: [], error: null }) }));
jest.mock("@/lib/erp/server", () => ({ listErpSystems: () => Promise.resolve([]) }));

import { GET as metricsGet } from "@/app/api/distributors/metrics/route";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Distributor ERP footprint", () => {
  beforeEach(() => {
    contextForMock.mockReset();
    rpcMock.mockReset();
    contextForMock.mockResolvedValue({ isAdmin: true, userId: "10000000-0000-4000-a000-000000000001", service: { rpc: rpcMock } });
  });

  it("fails closed when Migration 050 has not added the ERP distribution capability", async () => {
    rpcMock.mockResolvedValue({ data: { total: 1 }, error: null });
    const response = await metricsGet(new Request("http://localhost/api/distributors/metrics"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "DISTRIBUTOR_CAPABILITY_MISSING", message: expect.stringContaining("Migration 050") });
  });

  it("accepts a deployed empty ERP distribution instead of treating it as missing", async () => {
    rpcMock.mockResolvedValue({ data: { total: 0, erp_distribution: [] }, error: null });
    const response = await metricsGet(new Request("http://localhost/api/distributors/metrics"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ metrics: { erp_distribution: [] } });
  });

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
    expect(page).not.toMatch(/PieChart|stableErpColor|\/api\/distributors\/erp-analytics|erp_distribution\s*\?\?\s*\[\]/);
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
    expect(shared).not.toContain("Distributor total");
    expect(shared).toContain("displayed total");
  });

  it("keeps canonical ERP and ERP Not Set distinct in the Distributor presentation model", () => {
    expect(erpDistributionLabel({ erp_name: "MARG", state: "erp", count: 2 })).toBe("MARG");
    expect(erpDistributionLabel({ erp_name: null, state: "unset", count: 1 })).toBe("ERP Not Set");
    expect(erpDistributionReconciles([{ count: 2 }, { count: 1 }], 3)).toBe(true);
    expect(erpDistributionReconciles([{ count: 2 }, { count: 1 }], 4)).toBe(false);
  });
});
