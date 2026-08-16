import fs from "node:fs";
import path from "node:path";
import { VisitConfirmationSchema, validateNewVisit } from "@/app/api/field-visits/confirm/route";
import { PincodeSchema } from "@/lib/fieldVisits/contract";
import { buildFieldVisitConfirmPayload, resolveVisitConfirmationMode } from "@/lib/fieldVisits/sync";
import type { LocalFieldVisit } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

function currentVisit(overrides: Record<string, unknown> = {}) {
  const date = getCurrentISTDate();
  return {
    visit_id: "00000000-0000-4000-8000-000000000010", lead_id: "party", user_id: "00000000-0000-4000-8000-000000000001",
    visit_date: date, check_in_time: `${date}T10:00:00+05:30`, check_in_lat: 18.5, check_in_lng: 73.8,
    location_accuracy_m: 15, location_captured_at: `${date}T10:00:00+05:30`, location_acquisition_mode: "high_accuracy", location_quality: "good",
    check_in_photo_url: null, visit_outcome: "interested", visit_notes: null, attendance_id: null, person_met: "Owner", address: "Main Road",
    segment_type: "Retailer", follow_up_date: null, created_at: `${date}T04:30:00.000Z`, updated_at: `${date}T04:30:00.000Z`,
    ...overrides,
  };
}

describe("Field Visit pincode closure", () => {
  it("keeps pincode as bounded text and preserves leading zeroes", () => {
    expect(PincodeSchema.parse(" 012345 ")).toBe("012345");
    expect(PincodeSchema.safeParse("").success).toBe(false);
    expect(PincodeSchema.safeParse("x".repeat(33)).success).toBe(false);
  });

  it("requires pincode for current visits while accepting the previous queued shape", () => {
    const legacy = VisitConfirmationSchema.parse(currentVisit());
    expect(validateNewVisit(legacy)).toBe(false);
    const current = VisitConfirmationSchema.parse(currentVisit({ pincode: "012345", pincode_contract_version: 1 }));
    expect(validateNewVisit(current)).toBe(true);
  });

  it("serializes pincode in the existing Visit confirmation payload and retains legacy compatibility", () => {
    const base = currentVisit({ check_in_time: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) as LocalFieldVisit;
    expect(buildFieldVisitConfirmPayload({ ...base, pincode: "012345", pincode_contract_version: 1 })).toMatchObject({ pincode: "012345", pincode_contract_version: 1 });
    expect(buildFieldVisitConfirmPayload(base)).toMatchObject({ pincode: null });
    expect(buildFieldVisitConfirmPayload(base)).not.toHaveProperty("pincode_contract_version");
    expect(resolveVisitConfirmationMode({ ...base, confirmation_mode: "new" }, "new")).toBe("recovery");
    expect(resolveVisitConfirmationMode({ ...base, pincode: "012345", pincode_contract_version: 1, confirmation_mode: "new" }, "recovery")).toBe("new");
  });

  it("keeps the exact form order and address backend authority", () => {
    const retailer = read("src/app/visits/new/retailer/page.tsx");
    const distributor = read("src/app/visits/new/distributor/page.tsx");
    for (const form of [retailer, distributor]) {
      expect(form.indexOf('htmlFor="visit-address"')).toBeLessThan(form.indexOf('htmlFor="visit-pincode"'));
      expect(form.indexOf('htmlFor="visit-pincode"')).toBeLessThan(form.lastIndexOf('"Save Visit"'));
      expect(form).toContain("address: address.trim()");
      expect(form).toContain("pincode: pincode.trim()");
    }
    expect(retailer).toContain('className="field-label">Area ');
    expect(distributor).toContain('className="field-label">Address ');
  });

  it("closes employee/admin read and Excel export without another request", () => {
    expect(read("src/app/api/field-visits/mine/route.ts")).toContain("address,pincode");
    expect(read("src/app/api/admin/visits/route.ts")).toContain("address,pincode");
    const adminPage = read("src/app/admin/visits/page.tsx");
    expect(adminPage).toContain("Pincode:");
    expect(adminPage).toContain('visit.segment_type === "Retailer" ? "Area" : "Address"');
    const exportRoute = read("src/app/api/admin/export-visits/route.ts");
    expect(exportRoute).toContain('segment === "Retailer" ? "Area"');
    expect(exportRoute).toContain(': "Address"');
    expect(exportRoute).toContain("Pincode: visit.pincode ?? \"\"");
    expect([read("src/app/visits/new/retailer/page.tsx"), read("src/app/visits/new/distributor/page.tsx")].join("\n")).not.toMatch(/fetch\([^)]*pincode/i);
  });

  it("keeps historical NULL pincode readable and migration additive", () => {
    const migration = read("supabase/migrations/041_field_visit_pincode.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS pincode text NULL");
    expect(migration).not.toMatch(/UPDATE\s+public\.field_visits|SET\s+pincode|ALTER COLUMN pincode SET NOT NULL/i);
    expect(read("src/app/admin/visits/page.tsx")).toContain('visit.pincode?.trim() || "—"');
  });

  it("terminates deterministic 4xx and bounds transient backoff without touching protected domains", () => {
    const sync = read("src/lib/fieldVisits/sync.ts");
    expect(sync).toContain("response.status >= 400 && response.status < 500");
    expect(sync).toContain('sync_stage: terminal ? "review_required" : "sync_failed"');
    expect(sync).toContain('visit.sync_stage !== "review_required"');
    expect(sync).toContain("MAX_TRANSIENT_BACKOFF_MS");
    const changed = [sync, read("src/app/api/field-visits/confirm/route.ts")].join("\n");
    expect(changed).not.toMatch(/receivable_payments|lead_payment_details|pipeline_transition|call_logs|client_queries/);
  });
});
