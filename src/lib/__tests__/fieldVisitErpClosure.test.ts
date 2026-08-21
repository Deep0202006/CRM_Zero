import fs from "fs";
import path from "path";
import type { LocalFieldVisit } from "@/lib/db";
import { canonicalErpConfirmation, VisitConfirmationSchema } from "@/app/api/field-visits/confirm/route";
import { buildFieldVisitConfirmPayload, canonicalErpReconciliation } from "@/lib/fieldVisits/sync";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const baseVisit: LocalFieldVisit = {
  visit_id: "00000000-0000-4000-8000-000000000010",
  lead_id: "business-1",
  user_id: "00000000-0000-4000-8000-000000000001",
  visit_date: "2026-08-21",
  check_in_time: "2026-08-21T04:00:00.000Z",
  check_in_lat: 28,
  check_in_lng: 77,
  check_in_photo_url: null,
  visit_outcome: "interested",
  visit_notes: null,
  address: "Main Road",
  pincode: "110001",
  pincode_contract_version: 1,
  segment_type: "Retailer",
  created_at: "2026-08-21T04:00:00.000Z",
  updated_at: "2026-08-21T04:00:00.000Z",
};

describe("Field Visit ERP write/offline/sync/read closure", () => {
  test.each([
    ["existing ERP", { erp_usage_state: "erp" as const, erp_name_input: "MARG", erp_id: "00000000-0000-4000-8000-000000000020", erp_name: "MARG" }],
    ["custom ERP", { erp_usage_state: "erp" as const, erp_name_input: "Custom ERP", erp_id: null, erp_name: null }],
    ["explicit None", { erp_usage_state: "none" as const, erp_name_input: null, erp_id: null, erp_name: null }],
  ])("whitelists %s from the local record to confirmation", (_label, observation) => {
    const payload = buildFieldVisitConfirmPayload({ ...baseVisit, erp_contract_version: 1, ...observation });
    expect(payload).toMatchObject({ erp_contract_version: 1, ...observation });
    expect(payload.visit_id).toBe(baseVisit.visit_id);
  });

  it("keeps pre-contract queued visits compatible without inventing None", () => {
    const payload = buildFieldVisitConfirmPayload(baseVisit);
    expect(payload).not.toHaveProperty("erp_contract_version");
    expect(payload).not.toHaveProperty("erp_usage_state");
  });

  it("rejects a current-contract ERP selection without an ERP name", () => {
    const payload = buildFieldVisitConfirmPayload({ ...baseVisit, erp_contract_version: 1, erp_usage_state: "erp", erp_name_input: "" });
    expect(VisitConfirmationSchema.safeParse(payload).success).toBe(false);
    expect(VisitConfirmationSchema.safeParse({ ...payload, erp_usage_state: "none", erp_name_input: null }).success).toBe(true);
  });

  it("closes both capture journeys and the owner-scoped canonical read", () => {
    for (const page of [read("src/app/visits/new/retailer/page.tsx"), read("src/app/visits/new/distributor/page.tsx")]) {
      expect(page).toContain("saveVisitWithMedia(visitRecord, photoBlob)");
      expect(page).toContain("erp_contract_version: 1 as const");
      expect(page).toContain("isCompleteErpObservation(erp)");
    }
    const mine = read("src/app/api/field-visits/mine/route.ts");
    expect(mine).toContain('.eq("user_id", auth.user.id)');
    expect(mine).toContain("erp_id,erp_usage_state,erp_systems(erp_name)");
    expect(mine).toContain("erp_name:");
  });

  it("treats ERP contract failures as deterministic client errors", () => {
    const route = read("src/app/api/field-visits/confirm/route.ts");
    expect(route).toContain('code === "ERP_REQUIRED" || code === "ERP_INVALID" ? 422');
    expect(route).toContain('return response(422, "ERP_REQUIRED", "ERP_REQUIRED")');
    expect(route).toContain('"ERP_VISIT_CAPABILITY_MISSING"');
    expect(route).toContain("? 422 : 503");
  });

  it("reconciles canonical ERP resolution onto the same local visit identity", () => {
    const canonical = canonicalErpConfirmation({
      erp_id: "00000000-0000-4000-8000-000000000020",
      erp_usage_state: "erp",
      erp_systems: [{ erp_name: "Canonical MARG" }],
    });
    const local = { ...baseVisit, erp_contract_version: 1 as const, erp_usage_state: "erp" as const, erp_name_input: " marg " };
    expect(canonical).toEqual({
      erp_id: "00000000-0000-4000-8000-000000000020",
      erp_name: "Canonical MARG",
      erp_usage_state: "erp",
    });
    expect(canonicalErpReconciliation(local, { ok: true, code: "VISIT_CONFIRMED", ...canonical })).toEqual({
      erp_id: canonical.erp_id,
      erp_name: canonical.erp_name,
      erp_name_input: canonical.erp_name,
      erp_usage_state: "erp",
    });
    expect(local.visit_id).toBe(baseVisit.visit_id);
  });

  it("keeps explicit None distinct during canonical reconciliation", () => {
    expect(canonicalErpReconciliation(
      { ...baseVisit, erp_contract_version: 1, erp_usage_state: "none", erp_name_input: null },
      { ok: true, code: "VISIT_CONFIRMED", erp_usage_state: "none", erp_id: null, erp_name: null },
    )).toEqual({ erp_usage_state: "none", erp_id: null, erp_name: null, erp_name_input: null });
  });
});
