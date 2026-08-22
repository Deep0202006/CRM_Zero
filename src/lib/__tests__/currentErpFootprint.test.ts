import fs from "fs";
import path from "path";
import { buildErpDonutModel, stableErpColor, type FieldVisitErpSegment } from "@/components/analytics/FieldVisitErpIntelligence";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const segment = (overrides: Partial<FieldVisitErpSegment> = {}): FieldVisitErpSegment => ({
  unique_businesses: 4, observed_count: 3, erp_using_count: 2, none_count: 1, not_captured_count: 1, coverage_percent: 75,
  categories: [
    { erp_name: "MARG", state: "erp", count: 2, share_percent: 50 },
    { erp_name: "None", state: "none", count: 1, share_percent: 25 },
    { erp_name: "Not captured", state: "not_captured", count: 1, share_percent: 25 },
  ],
  ...overrides,
});

describe("Current ERP footprint donuts", () => {
  it("assigns the same normalized ERP identity the same color across charts", () => {
    expect(stableErpColor("MARG")).toBe(stableErpColor(" marg "));
    expect(stableErpColor("MARG ERP")).toBe(stableErpColor("marg   erp"));
    expect(stableErpColor("MARG")).toMatch(/^var\(--viz-series-[1-8]\)$/);
  });

  it("keeps explicit None and unknown Not captured visually and semantically distinct", () => {
    const model = buildErpDonutModel(segment());
    expect(model.reconciled).toBe(true);
    expect(model.slices.find((slice) => slice.state === "none")).toMatchObject({ label: "None (explicit)", color: "var(--viz-warning)" });
    expect(model.slices.find((slice) => slice.state === "not_captured")).toMatchObject({ label: "Not captured (unknown)", color: "var(--viz-muted)" });
  });

  it("refuses to render a misleading composition when totals do not reconcile", () => {
    expect(buildErpDonutModel(segment({ unique_businesses: 5 })).reconciled).toBe(false);
    expect(buildErpDonutModel(segment({ none_count: 2 })).reconciled).toBe(false);
    expect(buildErpDonutModel(segment({ observed_count: 4 })).reconciled).toBe(false);
  });

  it("renders separate accessible Retailer and Distributor donuts from V2 current intelligence", () => {
    const panel = read("src/components/analytics/FieldVisitErpIntelligence.tsx");
    const shared = read("src/components/analytics/ErpDistributionDonut.tsx");
    const route = read("src/app/api/admin/visits/erp-analytics/route.ts");
    expect(route).toContain('admin.rpc("field_visit_erp_intelligence_v2")');
    expect(panel).toContain('<ErpFootprintDonut name="Retailer"');
    expect(panel).toContain('<ErpFootprintDonut name="Distributor"');
    expect(shared).toContain("<PieChart accessibilityLayer>");
    expect(shared).toContain("rootTabIndex={0}");
    expect(shared).toContain('className="sr-only"');
    expect(shared).toContain("the donut is hidden instead of presenting misleading intelligence");
    expect(panel).toContain('totalLabel={name === "Retailer" ? "Retailers" : "Distributors"}');
    expect(panel).not.toContain(">Unique businesses</span>");
  });
});
