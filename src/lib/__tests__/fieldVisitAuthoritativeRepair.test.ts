import fs from "fs";
import path from "path";
import type { LocalFieldVisit } from "@/lib/db";
import { calculateOwnVisitMetrics } from "@/lib/fieldVisits/metrics";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const visit = (overrides: Partial<LocalFieldVisit>): LocalFieldVisit => ({
  visit_id: "visit-1",
  lead_id: "lead-1",
  user_id: "user-1",
  visit_date: "2026-08-01",
  check_in_time: "2026-08-01T05:00:00.000Z",
  check_in_lat: null,
  check_in_lng: null,
  check_in_photo_url: null,
  visit_outcome: "interested",
  visit_notes: null,
  created_at: "2026-08-01T05:00:00.000Z",
  updated_at: "2026-08-01T05:00:00.000Z",
  ...overrides,
});

describe("authoritative personal visit metrics", () => {
  it("uses remote count plus genuinely local-only pending IDs", () => {
    const metrics = calculateOwnVisitMetrics("user-1", "2026-08-01", 91, 1, [
      visit({ visit_id: "already-remote", sync_status: "pending_sync" }),
      visit({ visit_id: "local-only", sync_status: "pending_sync" }),
    ], ["already-remote"]);
    expect(metrics).toEqual({ totalVisits: 92, visitsToday: 2, waitingToSync: 1 });
  });

  it("deduplicates local IDs, excludes another user, and counts failed work", () => {
    const metrics = calculateOwnVisitMetrics("user-1", "2026-08-01", 2, 0, [
      visit({ visit_id: "failed", sync_status: "sync_failed" }),
      visit({ visit_id: "failed", sync_status: "sync_failed" }),
      visit({ visit_id: "other", user_id: "user-2", sync_status: "pending_sync" }),
    ], []);
    expect(metrics).toEqual({ totalVisits: 3, visitsToday: 1, waitingToSync: 1 });
  });

  it("is stable when refreshed with the same remote and local snapshots", () => {
    const local = [visit({ visit_id: "local", sync_status: "pending_sync" })];
    expect(calculateOwnVisitMetrics("user-1", "2026-08-01", 4, 0, local, []))
      .toEqual(calculateOwnVisitMetrics("user-1", "2026-08-01", 4, 0, local, []));
  });

  it("keeps cached confirmed visits in offline totals without marking them pending", () => {
    const metrics = calculateOwnVisitMetrics("user-1", "2026-08-01", 0, 0, [
      visit({ visit_id: "confirmed", sync_status: "synced", sync_stage: "synced" }),
    ], []);
    expect(metrics).toEqual({ totalVisits: 1, visitsToday: 1, waitingToSync: 0 });
  });
});

describe("authoritative admin visit contracts", () => {
  const route = read("src/app/api/admin/visits/route.ts");
  const page = read("src/app/admin/visits/page.tsx");
  const exportRoute = read("src/app/api/admin/export-visits/route.ts");

  it("defaults to all visits and keeps the directory independent of date", () => {
    expect(page).toContain('useState("")');
    expect(page).toContain("All visits");
    expect(route).toContain('const date = isValidISTDateKey(requestedDate) ? requestedDate : ""');
    expect(route.indexOf("loadRepresentativeDirectory(admin)")).toBeLessThan(route.indexOf("const { data: rawVisits"));
  });

  it("uses direct visit reads so an unavailable lead cannot hide a visit", () => {
    expect(route).toContain('select("visit_id,user_id,lead_id,visit_date');
    expect(route).not.toContain("users:user_id(");
    expect(route).not.toContain("leads:lead_id(");
    expect(route).toContain("leads: leadsById.get(visit.lead_id) ?? null");
    expect(page).toContain("Unavailable business");
  });

  it("returns exact all-time and today metrics separately from the 50-row page", () => {
    expect(route).toContain("const PAGE_SIZE = 50");
    expect(route).toContain('count: "exact", head: true');
    expect(route).toContain("all_time_total");
    expect(route).toContain("today_total");
  });

  it("surfaces directory/read failures instead of replacing them with empty state", () => {
    expect(route).toContain("Representative directory is temporarily unavailable.");
    expect(page).toContain('role="alert"');
    expect(page).not.toContain("setVisits([])");
  });

  it("exports all pages only on click, includes requested business/location metadata, and excludes evidence bytes", () => {
    expect(page).toContain("onClick={handleExport}");
    expect(exportRoute).toContain("for (let from = 0; ; from += EXPORT_PAGE_SIZE)");
    expect(exportRoute).not.toMatch(/signedUrl|base64|media_data|download\(/i);
    expect(exportRoute).toContain("check_in_lat");
    expect(exportRoute).toContain("selfie_purged_at");
    expect(exportRoute).toContain('date || "all"');
    expect(exportRoute).toContain("segment_type");
    expect(exportRoute).toContain("visit_outcome");
  });
});
