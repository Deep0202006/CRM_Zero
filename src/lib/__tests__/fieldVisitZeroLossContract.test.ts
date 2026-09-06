import fs from "fs";
import path from "path";
import { buildFieldVisitConfirmPayload } from "@/lib/fieldVisits/sync";
import type { LocalFieldVisit } from "@/lib/db";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const route = read("src/app/api/field-visits/confirm/route.ts");
const contract = read("src/app/api/field-visits/confirm/contract.ts");
const sync = read("src/lib/fieldVisits/sync.ts");
const retailer = read("src/app/visits/new/retailer/page.tsx");
const distributor = read("src/app/visits/new/distributor/page.tsx");
const visitsPage = read("src/app/visits/page.tsx");
const adminPage = read("src/app/admin/visits/page.tsx");
const adminRoute = read("src/app/api/admin/visits/route.ts");

describe("field visit zero-loss contract", () => {
  it("never lets evidence block the business-row insertion", () => {
    expect(route.indexOf('.from("field_visits").insert({ ...coreRemotePayload(visit, resolvedAttendanceId), ...optionalRemotePayload(visit) })')).toBeGreaterThan(0);
    expect(route.indexOf('.from("field_visits").insert({ ...coreRemotePayload(visit, resolvedAttendanceId), ...optionalRemotePayload(visit) })')).toBeLessThan(route.indexOf('.from("visits-evidence").upload'));
    expect(route).toContain("VISIT_CONFIRMED_EVIDENCE_PENDING");
  });

  it("authenticates an active account and verifies capability, segment, owner, attendance, and exact ID", () => {
    expect(route).toContain("admin.auth.getUser(token)");
    expect(route).toContain('.from("users").select("user_id,is_active")');
    expect(route).toContain('.from("user_capabilities").select("capability_code")');
    expect(route).toContain('visit.user_id !== auth.user.id');
    expect(route).toContain('capabilities.has("field_ret")');
    expect(route).toContain('capabilities.has("field_dist")');
    expect(route).toContain('"ATTENDANCE_NOT_CONFIRMED"');
    expect(route).toContain('confirmed.user_id !== auth.user.id');
    expect(route).toContain('confirmed.visit_id !== visit.visit_id');
    expect(contract).toContain('lead_id: z.string().trim().min(1).max(250)');
    expect(contract).toContain('lead && lead.segment_type !== segment');
  });

  it("uses service role only in the server route and handles duplicate requests idempotently", () => {
    expect(route).toContain("createServerServiceClient");
    expect(route).toContain('insertError?.code === "23505"');
    expect(route).toContain("alreadyConfirmed = true");
    expect(route).toContain("equalEvidence(admin, evidencePath, selfie)");
    expect(sync).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("removes direct browser visit inserts and evidence uploads", () => {
    expect(sync).not.toContain('.from("field_visits")');
    expect(sync).not.toContain('.from("visits-evidence")');
    expect(sync).not.toContain(".upload(");
    expect(sync).toContain('fetch("/api/field-visits/confirm"');
    expect(read("src/lib/db.ts")).toContain('if (item.table_name === "field_visits") continue;');
  });

  it("whitelists remote fields and excludes all local diagnostics", () => {
    const local: LocalFieldVisit = {
      visit_id: "00000000-0000-4000-8000-000000000010", lead_id: "lead", user_id: "00000000-0000-4000-8000-000000000001",
      visit_date: "2026-08-04", check_in_time: "2026-08-04T04:00:00.000Z", check_in_lat: 1, check_in_lng: 2,
      check_in_photo_url: null, visit_outcome: "interested", visit_notes: null, created_at: "2026-08-04T04:00:00.000Z", updated_at: "2026-08-04T04:00:00.000Z",
      sync_status: "sync_failed", sync_stage: "sync_failed", sync_error_code: "SECRET", sync_error_message: "raw error", sync_attempt_count: 7, last_sync_attempt_at: "now",
    };
    const payload = buildFieldVisitConfirmPayload(local) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([
      "visit_id", "lead_id", "user_id", "visit_date", "check_in_time", "check_in_lat", "check_in_lng", "location_accuracy_m", "location_captured_at", "location_acquisition_mode", "location_quality", "check_in_photo_url", "selfie_captured_at", "selfie_capture_method", "selfie_storage_path", "visit_outcome", "visit_notes", "attendance_id", "person_met", "address", "pincode", "segment_type", "follow_up_date", "created_at", "updated_at",
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/sync_status|sync_stage|sync_error|sync_attempt|last_sync|raw error|SECRET/);
  });

  it("makes online success conditional, reuses visit IDs, and labels offline work unconfirmed", () => {
    for (const form of [retailer, distributor]) {
      expect(form).toContain("pendingVisitId ?? crypto.randomUUID()");
      expect(form).toContain('await syncFieldVisits(visitId, currentUser.user_id, "new")');
      expect(form).toContain("await db.field_visits.get(visitId)");
      expect(form).toContain('confirmed?.sync_stage === "synced"');
      expect(form).toContain("Saved offline — not yet confirmed.");
      expect(form).not.toContain("saved locally. Syncing in background");
    }
  });

  it("keeps pending/failed/evidence work recoverable and permanently retains emergency media", () => {
    expect(visitsPage).toContain("Recover unsynced visits");
    expect(visitsPage).toContain("await processSyncQueue()");
    expect(visitsPage).toContain("Safe failure codes:");
    expect(visitsPage).toContain('syncFieldVisits(undefined, currentUser?.user_id, "recovery")');
    expect(sync).toContain('visit.sync_stage === "visit_confirmed_evidence_pending"');
    expect(sync).not.toContain("field_visit_media.delete");
    expect(sync).toContain('result.code === "VISIT_CONFIRMED" && (!mediaRecord || result.evidence_confirmed)');
    expect(sync).not.toMatch(/field_visit_media\.clear|field_visit_media\.bulkDelete/);
    expect(route).toContain('code: evidenceConfirmed ? "VISIT_CONFIRMED" : "VISIT_CONFIRMED_EVIDENCE_PENDING"');
    expect(sync).toContain("markKnownUserFailures");
  });

  it("shows confirmed admin rows even when evidence is pending", () => {
    expect(adminRoute).toContain('selfie_status: visit.selfie_purged_at ? "PURGED" : visit.selfie_storage_path ? "AVAILABLE" : "PENDING"');
    expect(adminPage).toContain('"Evidence pending"');
    expect(adminRoute).toContain("leadsById.get(visit.lead_id) ?? null");
  });

  it("introduces no visit deletion or browser-database reset", () => {
    const changed = [route, sync, retailer, distributor, visitsPage, adminPage, adminRoute].join("\n");
    expect(changed).not.toMatch(/field_visits[^\n]*\.delete\(|indexedDB\.deleteDatabase|localStorage\.clear\(|db\.delete\(/);
  });

  it("does not alter KPI, call/task, payment-reminder, or verified-logout implementations", () => {
    expect(read("src/app/api/my-day/payment-followups/route.ts")).toContain('.from("field_visits")');
    expect(read("src/context/AuthContext.tsx")).toContain("Verified logout failed");
    expect(read("src/lib/teamKpi/aggregate.ts")).toContain("KpiUserRecord");
    expect(read("src/lib/db.ts")).toContain('item.table_name === "call_logs"');
  });
});
