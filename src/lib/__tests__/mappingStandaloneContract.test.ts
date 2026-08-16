import fs from "node:fs";
import path from "node:path";
import { buildCanonicalClientOptions, MAPPING_BUSINESS_VALUE_MAX_LENGTH, resolveClientOptionInput } from "@/lib/clientOptions";
import { mappingRequestSchema } from "@/lib/validation";
import { isTerminalMappingSyncError } from "@/lib/db";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("standalone Mapping contract", () => {
  const directory = [
    { username: "RET002", name: "Retail Two" },
    { username: "DIST001", name: "Distributor One" },
  ];

  it("gives Calls, Client Query, and Mapping one canonical option provider", () => {
    const options = buildCanonicalClientOptions(directory);
    expect(options.map((option) => option.label)).toEqual(["Distributor One (@DIST001)", "Retail Two (@RET002)"]);
    for (const file of ["src/app/call-logs/page.tsx", "src/app/support/page.tsx", "src/app/mappings/page.tsx"]) {
      expect(read(file)).toContain("buildCanonicalClientOptions");
    }
  });

  it.each([
    "ABC MEDICAL & GENERAL STORE",
    "Retailer #42 (North)",
    "Distributor 100/200",
  ])("preserves arbitrary display text: %s", (value) => {
    expect(resolveClientOptionInput(`  ${value}  `, [])).toEqual({ displayValue: value, leadId: null });
  });

  it("accepts a selected suggestion without turning its directory identity into a Lead", () => {
    const options = buildCanonicalClientOptions(directory);
    expect(resolveClientOptionInput(options[0].value, options)).toEqual({ displayValue: options[0].label, leadId: null });
  });

  it("enforces only a reasonable structural display bound", () => {
    expect(resolveClientOptionInput("x".repeat(MAPPING_BUSINESS_VALUE_MAX_LENGTH), [])).toMatchObject({ leadId: null });
    expect(() => resolveClientOptionInput("x".repeat(MAPPING_BUSINESS_VALUE_MAX_LENGTH + 1), [])).toThrow();
  });

  it("validates free-text mapping rows with stable IDs and actor metadata", () => {
    expect(mappingRequestSchema.safeParse({
      request_id: "00000000-0000-4000-8000-000000000001",
      distributor_lead_id: null,
      retailer_lead_id: null,
      distributor_name_unregistered: "ABC & Co.",
      retailer_name_unregistered: "Store 42",
      requested_by: "00000000-0000-4000-8000-000000000002",
      mapped_by: "00000000-0000-4000-8000-000000000002",
      status: "Pending",
      created_at: "2026-08-16T00:00:00.000Z",
    }).success).toBe(true);
  });

  it("has zero Lead or Pipeline write authority", () => {
    const page = read("src/app/mappings/page.tsx");
    expect(page).not.toMatch(/transactionalMutation\(["']leads|db\.leads|resolveLeadId|Mapping Form|pipeline/i);
    expect(page).toContain('transactionalMutation("mapping_requests", "INSERT"');
    expect(page).toContain("distributor_name_unregistered");
    expect(page).toContain("retailer_name_unregistered");
  });

  it("adds no writes to protected cross-domain tables", () => {
    const page = read("src/app/mappings/page.tsx");
    expect(page).not.toMatch(/transactionalMutation\(["'](?:leads|lead_payment_details|receivable_payments|attendance|tasks|call_logs)/i);
  });

  it("does not automatically retry deterministic Mapping 4xx failures", () => {
    expect(isTerminalMappingSyncError({ code: "23514" })).toBe(true);
    expect(isTerminalMappingSyncError({ code: "42501" })).toBe(true);
    expect(isTerminalMappingSyncError({ code: "PGRST204" })).toBe(true);
    expect(isTerminalMappingSyncError({ code: "08006" })).toBe(false);
    const queue = read("src/lib/db.ts");
    expect(queue).toContain('item.table_name === "mapping_requests"');
    expect(queue).toContain("!isTerminalMappingSyncError(error)");
  });
});
