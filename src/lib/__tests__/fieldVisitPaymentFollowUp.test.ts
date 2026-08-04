import fs from "fs";
import path from "path";
import { FieldVisitSchema, getOutcomeLabel } from "@/lib/fieldVisits/contract";
import { getCurrentISTDate, getISTBusinessDayBounds, isValidISTDateKey } from "@/lib/dateTime";
import { mergePaymentFollowUps, resolvePaymentFollowUpIdentity } from "@/lib/fieldVisits/paymentFollowUps";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const today = getCurrentISTDate();
const baseVisit = {
  visit_id: "11111111-1111-4111-8111-111111111111",
  lead_id: "party-reference",
  user_id: "22222222-2222-4222-8222-222222222222",
  visit_date: today,
  check_in_time: new Date().toISOString(),
  person_met: "Owner",
  visit_notes: null,
  segment_type: "Distributor" as const,
  visit_outcome: "payment_follow_up" as const,
  follow_up_date: today,
  check_in_lat: null,
  check_in_lng: null,
  location_accuracy_m: null,
  location_captured_at: null,
  location_acquisition_mode: null,
  location_quality: null,
  selfie_captured_at: null,
  selfie_capture_method: null,
  selfie_storage_path: null,
  attendance_id: null,
};

describe("Distributor payment follow-up", () => {
  it("accepts the canonical outcome only for Distributor visits with a date", () => {
    expect(FieldVisitSchema.parse(baseVisit).visit_outcome).toBe("payment_follow_up");
    expect(FieldVisitSchema.safeParse({ ...baseVisit, segment_type: "Retailer" }).success).toBe(false);
    expect(FieldVisitSchema.safeParse({ ...baseVisit, follow_up_date: null }).success).toBe(false);
  });

  it("rejects a past payment follow-up date", () => {
    expect(FieldVisitSchema.safeParse({ ...baseVisit, follow_up_date: "2000-01-01" }).success).toBe(false);
  });

  it("rejects calendar-impossible India dates", () => {
    expect(isValidISTDateKey("2026-02-31")).toBe(false);
    expect(() => getISTBusinessDayBounds("2026-02-31")).toThrow("Invalid India business date");
    expect(FieldVisitSchema.safeParse({ ...baseVisit, follow_up_date: "2026-02-31" }).success).toBe(false);
  });

  it("labels the canonical outcome and preserves the migration value", () => {
    expect(getOutcomeLabel("payment_follow_up")).toBe("Payment follow-up");
    const migration = read("supabase/migrations/030_distributor_payment_followup.sql");
    expect(migration).toContain("'payment_follow_up'");
    expect(migration).toContain("segment_type = 'Distributor' AND follow_up_date IS NOT NULL");
    expect(migration).not.toMatch(/UPDATE\s+public\.field_visits/i);
  });

  it("uses exact stored identity and truthful unavailable fallbacks", () => {
    expect(resolvePaymentFollowUpIdentity(
      { visit_id: "visit-1", lead_id: "Party One (@DIST001)", follow_up_date: today },
      null,
    )).toMatchObject({ username: "DIST001", party_name: "Party One" });
    expect(resolvePaymentFollowUpIdentity(
      { visit_id: "visit-2", lead_id: "unmatched-reference", follow_up_date: today },
      null,
    )).toMatchObject({ username: "Username unavailable", party_name: "Party unavailable" });
  });

  it("deduplicates local and remote by visit_id and excludes another employee and future dates", () => {
    const remote = [{ visit_id: "same", follow_up_date: today, username: "U1", party_name: "P1", visit_outcome: "payment_follow_up" as const }];
    const local = [
      { visit_id: "same", lead_id: "Party (@U1)", user_id: "owner", follow_up_date: today, segment_type: "Distributor", visit_outcome: "payment_follow_up", sync_status: "sync_failed" },
      { visit_id: "other-user", lead_id: "Party (@U2)", user_id: "other", follow_up_date: today, segment_type: "Distributor", visit_outcome: "payment_follow_up", sync_status: "sync_failed" },
      { visit_id: "future", lead_id: "Party (@U3)", user_id: "owner", follow_up_date: "2099-01-01", segment_type: "Distributor", visit_outcome: "payment_follow_up", sync_status: "pending_sync" },
    ];
    expect(mergePaymentFollowUps("owner", today, remote, local)).toEqual(remote);
  });

  it("computes exact Asia/Kolkata UTC bounds", () => {
    expect(getISTBusinessDayBounds("2026-08-03")).toEqual({
      startsAt: "2026-08-02T18:30:00.000Z",
      endsAt: "2026-08-03T18:30:00.000Z",
    });
  });

  it("keeps the reminder outside call, task, and KPI accounting", () => {
    const endpoint = read("src/app/api/my-day/payment-followups/route.ts");
    expect(endpoint).toContain('.from("field_visits")');
    expect(endpoint).not.toMatch(/call_logs|tasks|team_kpi|work_metrics/i);
    expect(read("src/lib/teamKpi/serverReport.ts")).not.toContain("payment_follow_up");
    expect(read("src/lib/workMetrics/canonical.ts")).not.toContain("payment_follow_up");
  });
});
