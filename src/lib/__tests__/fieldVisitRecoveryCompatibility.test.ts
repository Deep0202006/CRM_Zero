import fs from "fs";
import path from "path";
import { coreRemotePayload, optionalRemotePayload, resolveAttendanceId, validateLeadCompatibility, validateNewVisit, VisitConfirmationSchema } from "@/app/api/field-visits/confirm/route";
import { getCurrentISTDate } from "@/lib/dateTime";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

function visit(overrides: Record<string, unknown> = {}) {
  const date = getCurrentISTDate();
  return {
    visit_id: "00000000-0000-4000-8000-000000000010",
    lead_id: "Legacy Party (@historical)",
    user_id: "00000000-0000-4000-8000-000000000001",
    visit_date: date,
    check_in_time: `${date}T10:00:00+05:30`,
    check_in_lat: null,
    check_in_lng: null,
    check_in_photo_url: null,
    visit_outcome: "interested",
    visit_notes: null,
    attendance_id: "00000000-0000-4000-8000-000000000020",
    person_met: null,
    segment_type: "Retailer",
    follow_up_date: null,
    created_at: `${date}T04:30:00.000Z`,
    updated_at: `${date}T04:30:00.000Z`,
    ...overrides,
  };
}

describe("final field visit recovery compatibility", () => {
  it("accepts text and non-UUID historical lead references", () => {
    expect(VisitConfirmationSchema.safeParse(visit()).success).toBe(true);
    expect(validateLeadCompatibility("recovery", "Legacy Party (@historical)", "Retailer", null)).toEqual({ allowed: true, warning: "BUSINESS_REFERENCE_WARNING" });
  });

  it("allows a missing lead row in both recovery and new mode with a warning", () => {
    expect(validateLeadCompatibility("recovery", "missing-reference", "Retailer", null).allowed).toBe(true);
    expect(validateLeadCompatibility("new", "00000000-0000-4000-8000-000000000099", "Retailer", null)).toEqual({ allowed: true, warning: "BUSINESS_REFERENCE_WARNING" });
  });

  it("rejects a current UUID lead whose segment mismatches", () => {
    expect(validateLeadCompatibility("new", "00000000-0000-4000-8000-000000000099", "Retailer", { lead_id: "00000000-0000-4000-8000-000000000099", segment_type: "Distributor" }).allowed).toBe(false);
  });

  it("resolves canonical attendance even when the submitted local ID differs", () => {
    const canonical = { attendance_id: "00000000-0000-4000-8000-000000000020", user_id: "00000000-0000-4000-8000-000000000001", date: getCurrentISTDate() };
    expect(resolveAttendanceId([canonical], "00000000-0000-4000-8000-000000000099")).toEqual({ attendanceId: canonical.attendance_id, integrityError: false });
    expect(resolveAttendanceId([canonical], canonical.attendance_id)).toEqual({ attendanceId: canonical.attendance_id, integrityError: false });
  });

  it("refuses ambiguous attendance and queries only the authenticated owner/date", () => {
    const row = { attendance_id: "00000000-0000-4000-8000-000000000020", user_id: "00000000-0000-4000-8000-000000000001", date: getCurrentISTDate() };
    expect(resolveAttendanceId([row, { ...row, attendance_id: "00000000-0000-4000-8000-000000000021" }], null)).toEqual({ attendanceId: null, integrityError: true });
    const route = read("src/app/api/field-visits/confirm/route.ts");
    expect(route).toContain('.eq("user_id", auth.user.id).eq("date", visit.visit_date)');
    expect(route).not.toContain('.eq("attendance_id", visit.attendance_id)');
  });

  it("accepts legacy missing optional GPS/person/selfie metadata", () => {
    const parsed = VisitConfirmationSchema.safeParse(visit());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(validateNewVisit(parsed.data)).toBe(false);
  });

  it("keeps new mode strict about complete current GPS and person metadata", () => {
    const parsed = VisitConfirmationSchema.parse(visit({
      lead_id: "00000000-0000-4000-8000-000000000099",
      check_in_lat: 22.3,
      check_in_lng: 73.2,
      location_accuracy_m: 15,
      location_captured_at: `${getCurrentISTDate()}T10:00:00+05:30`,
      location_acquisition_mode: "high_accuracy",
      location_quality: "good",
      person_met: "Owner",
      address: "Main Road",
    }));
    expect(validateNewVisit(parsed)).toBe(true);
    expect(validateNewVisit({ ...parsed, location_accuracy_m: null })).toBe(false);
  });

  it("uses an exact core whitelist and keeps hardened fields optional", () => {
    const parsed = VisitConfirmationSchema.parse(visit());
    expect(Object.keys(coreRemotePayload(parsed, parsed.attendance_id!))).toEqual([
      "visit_id", "lead_id", "user_id", "visit_date", "check_in_time", "check_in_lat", "check_in_lng", "check_in_photo_url", "visit_outcome", "visit_notes", "attendance_id", "person_met", "address", "address_contract_version", "segment_type", "follow_up_date", "created_at", "updated_at",
    ]);
    expect(Object.keys(optionalRemotePayload(parsed))).toEqual([
      "location_accuracy_m", "location_captured_at", "location_acquisition_mode", "location_quality", "selfie_captured_at", "selfie_capture_method", "selfie_storage_path",
    ]);
  });

  it("falls back to the core payload on optional schema mismatch using the same ID", () => {
    const route = read("src/app/api/field-visits/confirm/route.ts");
    expect(route).toContain('insertError.code === "42703" || insertError.code === "PGRST204" || insertError.code === "23514"');
    expect(route).toContain('.insert(coreRemotePayload(visit, resolvedAttendanceId))');
    expect(route).toContain('warningCodes.push("OPTIONAL_SCHEMA_MISMATCH")');
    expect(route.match(/coreRemotePayload\(visit, resolvedAttendanceId\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("maps database errors without storing raw database content", () => {
    const route = read("src/app/api/field-visits/confirm/route.ts");
    expect(route).toContain('code === "23503"');
    expect(route).toContain('code === "23514"');
    expect(route).toContain('code === "42501"');
    expect(route).toContain('insertError?.code === "23505"');
    expect(read("src/lib/fieldVisits/sync.ts")).toContain("NETWORK_OR_SERVER_RESPONSE_FAILED");
  });

  it("preserves unrelated data and every recovery trigger", () => {
    const sources = [
      read("src/app/api/field-visits/confirm/route.ts"), read("src/lib/fieldVisits/sync.ts"),
      read("src/app/visits/page.tsx"), read("src/app/visits/new/retailer/page.tsx"), read("src/app/visits/new/distributor/page.tsx"),
    ].join("\n");
    expect(sources).not.toMatch(/db\.(field_visits|attendance|call_logs|tasks)\.delete|field_visit_media\.clear|indexedDB\.deleteDatabase|localStorage\.clear/);
    expect(read("src/lib/db.ts")).toContain('if (item.table_name === "field_visits") continue;');
    expect(read("src/context/AuthContext.tsx")).toContain("await Promise.allSettled([processSyncQueue(), syncFieldVisits()])");
    expect(read("src/lib/fieldVisits/sync.ts")).toContain('addEventListener("online"');
    expect(read("src/lib/fieldVisits/sync.ts")).toContain('addEventListener("visibilitychange"');
    expect(read("src/app/visits/page.tsx")).toContain('syncFieldVisits(undefined, currentUser.user_id, "recovery")');
  });
});
