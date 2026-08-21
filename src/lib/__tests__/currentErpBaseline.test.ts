import fs from "fs";
import path from "path";
import {
  currentErpLabel,
  operationForCustomErp,
  operationForExistingErp,
  type CurrentBusinessErpRow,
} from "@/lib/erp/currentBaseline";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const row = (overrides: Partial<CurrentBusinessErpRow> = {}): CurrentBusinessErpRow => ({
  segment_type: "Retailer",
  business_ref: "business-1",
  business_name: null,
  erp_usage_state: null,
  erp_id: null,
  erp_name: null,
  latest_visit_at: null,
  effective_at: null,
  provenance: "not_captured",
  source_ref: null,
  ...overrides,
});

describe("Admin current business ERP baseline", () => {
  it("keeps explicit None distinct from historical Not captured", () => {
    expect(currentErpLabel(row())).toBe("Not captured");
    expect(currentErpLabel(row({ erp_usage_state: "none" }))).toBe("None");
    expect(currentErpLabel(row({ erp_usage_state: "erp", erp_name: "MARG" }))).toBe("MARG");
  });

  it("normalizes custom names and rejects empty, oversized, and None aliases", () => {
    expect(operationForCustomErp("  Marg   ERP ")).toEqual({ operation: "set", erp_name: "Marg ERP" });
    expect(operationForCustomErp(" none ")).toBeNull();
    expect(operationForCustomErp(" ")).toBeNull();
    expect(operationForCustomErp("x".repeat(161))).toBeNull();
    expect(operationForExistingErp(" erp-id ")).toEqual({ operation: "set", erp_id: "erp-id" });
  });

  it("uses an Admin-only bounded route and one atomic batch RPC", () => {
    const route = read("src/app/api/admin/visits/erp-baselines/route.ts");
    expect(route).toContain('row.capability_code === "admin"');
    expect(route).toContain('Math.min(requestedLimit, 500)');
    expect(route).toContain('service.rpc("field_business_erp_current_v2"');
    expect(route).toContain('service.rpc("set_field_business_erp_baselines_v1"');
    expect(route).toContain("p_actor_id: authorization.actorId");
    expect(route).toContain("p_rows: parsed.data.operations");
    expect(route).not.toContain("p_operations:");
    expect(route).toContain("z.array(operationSchema).min(1).max(500)");
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY: process.env");
  });

  it("offers all edit modes and preserves drafts during safe refresh/error paths", () => {
    const editor = read("src/components/visits/CurrentErpBaselineEditor.tsx");
    for (const expected of ["SearchableSelect", "Clear Admin baseline", "label: \"None\"", "type a custom ERP"]) expect(editor).toContain(expected);
    expect(editor).toContain('normalized.toLocaleLowerCase("en-IN") === "none"');
    expect(editor).toContain("your unsaved edits were preserved");
    expect(editor).toContain("Unsaved edits remain available");
    expect(editor).toContain('body: JSON.stringify({ operations })');
    expect(editor).toContain('params.set("business_ref", appliedFilters.businessRef)');
  });

  it("provides business names, required filters, and current provenance timestamps", () => {
    const route = read("src/app/api/admin/visits/erp-baselines/route.ts");
    const editor = read("src/components/visits/CurrentErpBaselineEditor.tsx");
    expect(route).toContain('.from("leads").select("lead_id,business_name")');
    expect(route).toContain('params.get("state")');
    expect(route).toContain('params.get("query")');
    for (const heading of [">Type</th>", ">Latest visit</th>", ">Source</th>", ">Last updated</th>"]) expect(editor).toContain(heading);
    expect(editor).toContain("row.business_name?.trim() || row.business_ref");
    expect(editor).toContain('aria-label="Current ERP state"');
    expect(editor).toContain('aria-label="Search business or ERP"');
  });

  it("matches the exact Admin current ERP interaction labels", () => {
    const page = read("src/app/admin/visits/page.tsx");
    const editor = read("src/components/visits/CurrentErpBaselineEditor.tsx");
    expect(page).toContain("Manage Current ERP");
    for (const label of [">All</option>", ">Retailers</option>", ">Distributors</option>", ">All states</option>", ">Not captured</option>", ">ERP assigned</option>", ">None</option>"]) expect(editor).toContain(label);
    for (const source of ['? "Admin"', '? "Field Visit"', ': "Not captured"']) expect(editor).toContain(source);
    expect(editor).toContain("Save {operations.length} changes");
  });
});
