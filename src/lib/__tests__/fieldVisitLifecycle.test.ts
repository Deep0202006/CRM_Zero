import fs from "node:fs";
import path from "node:path";
import { attendanceEvidencePath, isExactAuthoritativePath, retentionCutoff, SELFIE_RETENTION_BATCH_SIZE } from "@/lib/fieldVisits/retention";
import { FieldVisitSchema, generateEvidencePath, getOutcomeLabel } from "@/lib/fieldVisits/contract";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const base = {
  visit_id: "00000000-0000-4000-8000-000000000001", lead_id: "lead", user_id: "00000000-0000-4000-8000-000000000002",
  visit_date: "2026-08-12", check_in_time: "2026-08-12T05:00:00.000Z", person_met: "निरज", address: "१२ मुख्य सड़क, पुणे",
  visit_notes: null, segment_type: "Retailer" as const, visit_outcome: "registered" as const, follow_up_date: null,
  check_in_lat: 18.52, check_in_lng: 73.85, location_accuracy_m: 10, location_captured_at: "2026-08-12T05:00:00.000Z",
  location_acquisition_mode: "high_accuracy" as const, location_quality: "good" as const, selfie_captured_at: "2026-08-12T05:00:00.000Z",
  selfie_capture_method: "live_camera" as const, selfie_storage_path: null, attendance_id: null,
};

describe("field visit lifecycle contract", () => {
  test("accepts Unicode address and distributor-only observational payment_done", () => {
    expect(FieldVisitSchema.parse(base).address).toBe(base.address);
    expect(FieldVisitSchema.parse({ ...base, segment_type: "Distributor", visit_outcome: "payment_done" }).visit_outcome).toBe("payment_done");
    expect(FieldVisitSchema.safeParse({ ...base, visit_outcome: "payment_done" }).success).toBe(false);
    expect(getOutcomeLabel("payment_done")).toBe("Payment done");
  });

  test("retention uses an exact five-day uploaded-time boundary and exact keys", () => {
    const now = new Date("2026-08-12T12:00:00.000Z");
    expect(retentionCutoff(now)).toBe("2026-08-07T12:00:00.000Z");
    expect(new Date("2026-08-07T12:00:01.000Z") <= new Date(retentionCutoff(now))).toBe(false);
    const visit = { kind: "visit" as const, id: base.visit_id, userId: base.user_id, date: base.visit_date, path: generateEvidencePath(base.user_id, base.visit_date, base.visit_id) };
    expect(isExactAuthoritativePath(visit)).toBe(true);
    expect(isExactAuthoritativePath({ ...visit, path: `other/${visit.path}` })).toBe(false);
    const attendanceId = "00000000-0000-4000-8000-000000000003";
    expect(isExactAuthoritativePath({ kind: "attendance", id: attendanceId, userId: base.user_id, date: base.visit_date, path: attendanceEvidencePath(base.user_id, base.visit_date, attendanceId) })).toBe(true);
    expect(SELFIE_RETENTION_BATCH_SIZE).toBe(200);
  });

  test("cleanup is Storage-API scoped and cannot delete business rows or mutate finance", () => {
    const retention = read("src/lib/fieldVisits/retention.ts");
    const routes = read("src/app/api/field-visits/confirm/route.ts") + read("src/lib/fieldVisits/sync.ts");
    expect(retention).toContain('.storage.from(SELFIE_BUCKET).remove([candidate.path])');
    expect(retention).not.toMatch(/delete\s+from|\.delete\(|storage\.objects|remove\(rows|remove\(paths/i);
    expect(routes).not.toMatch(/receivable_payments|lead_payment_details|pipeline_transition|call_logs/);
  });

  test("legacy queue repair preserves operation ID and media", () => {
    const sync = read("src/lib/fieldVisits/sync.ts");
    expect(sync).toContain("supplyQueuedVisitAddress");
    expect(sync).toContain('db.field_visits.update(visitId');
    expect(sync).not.toMatch(/field_visit_media\.(delete|clear)|field_visits\.(delete|clear)|indexedDB\.deleteDatabase|localStorage\.clear/);
  });

  test("overview is bounded and evidence is explicit only", () => {
    const route = read("src/app/api/admin/visits/route.ts");
    const page = read("src/app/admin/visits/page.tsx");
    expect(route).toContain("const PAGE_SIZE = 50");
    expect(route).toContain(".range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)");
    expect(page).toContain("View Selfie");
    expect(page).not.toMatch(/<img[^>]+selfie|createSignedUrl/);
  });
});
