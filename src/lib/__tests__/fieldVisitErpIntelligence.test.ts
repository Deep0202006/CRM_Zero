import fs from "fs";
import path from "path";
import { buildErpIntelligenceExportRows } from "@/app/api/admin/export-visits/route";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("Field Visit latest-unique-business ERP Intelligence", () => {
  it("partitions stable business identities by segment and chooses one latest observation", () => {
    const migration = read("supabase/migrations/048_field_visit_erp_observation.sql");
    expect(migration).toMatch(/distinct on \(f\.segment_type,f\.lead_id\)/);
    expect(migration).toContain("order by f.segment_type,f.lead_id,f.check_in_time desc,f.created_at desc,f.visit_id desc");
    expect(migration).toContain("unnest(array['Retailer','Distributor'])");
    expect(migration).toContain("when l.erp_usage_state='none' then 'None' else 'Not captured'");
  });

  it("exports complete latest-business summaries in separate segment sheets", () => {
    const segment = {
      unique_businesses: 4,
      observed_count: 3,
      erp_using_count: 2,
      none_count: 1,
      not_captured_count: 1,
      coverage_percent: 75,
      categories: [
        { erp_name: "MARG", count: 2, share_percent: 50 },
        { erp_name: "None", count: 1, share_percent: 25 },
        { erp_name: "Not captured", count: 1, share_percent: 25 },
      ],
    };
    const rows = buildErpIntelligenceExportRows("Retailer", segment);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ Segment: "Retailer", Metric: "Unique businesses", Value: 4 }),
      expect.objectContaining({ Segment: "Retailer", Metric: "Explicit None", Value: 1 }),
      expect.objectContaining({ Segment: "Retailer", Metric: "Not captured", Value: 1 }),
      expect.objectContaining({ Segment: "Retailer", Category: "MARG", Businesses: 2, "Share %": 50 }),
    ]));
    const route = read("src/app/api/admin/export-visits/route.ts");
    expect(route).toContain('admin.rpc("field_visit_erp_intelligence_v1")');
    expect(route).toContain('"Retailer ERP"');
    expect(route).toContain('"Distributor ERP"');
  });

  it("keeps admin intelligence server-authoritative, segment-separated, and recoverable", () => {
    const api = read("src/app/api/admin/visits/erp-analytics/route.ts");
    const page = read("src/app/admin/visits/page.tsx");
    const panel = read("src/components/analytics/FieldVisitErpIntelligence.tsx");
    expect(api).toContain('admin.rpc("field_visit_erp_intelligence_v1")');
    expect(api).toContain('row.capability_code === "admin"');
    expect(panel).toContain("segments.Retailer");
    expect(panel).toContain("segments.Distributor");
    expect(panel).toContain("Each business is counted once; repeat visits do not inflate totals.");
    expect(panel).toContain("var(--viz-primary)");
    expect(panel).not.toContain("var(--viz-1)");
    expect(page).toContain("ERP intelligence is temporarily unavailable.");
    expect(page).toContain(">Retry</Button>");
    expect(page).toContain("setErpSegments(null)");
  });
});
