import fs from "fs";
import path from "path";
import type { LocalFieldVisit } from "@/lib/db";
import { mergeOwnVisits } from "@/lib/fieldVisits/merge";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

function visit(overrides: Partial<LocalFieldVisit>): LocalFieldVisit {
  return {
    visit_id: crypto.randomUUID(),
    lead_id: "lead-1",
    user_id: "00000000-0000-4000-8000-000000000001",
    visit_date: "2026-07-31",
    check_in_time: "2026-07-31T04:00:00.000Z",
    check_in_lat: null,
    check_in_lng: null,
    check_in_photo_url: null,
    visit_outcome: "interested",
    visit_notes: null,
    sync_status: "pending_sync",
    created_at: "2026-07-31T04:00:00.000Z",
    updated_at: "2026-07-31T04:00:00.000Z",
    ...overrides,
  };
}

describe("field visit stabilization", () => {
  it("merges by visit_id, prefers remote confirmation, and excludes another representative", () => {
    const owner = "00000000-0000-4000-8000-000000000001";
    const sharedId = crypto.randomUUID();
    const rows = mergeOwnVisits(
      owner,
      [visit({ visit_id: sharedId }), visit({ user_id: "00000000-0000-4000-8000-000000000002" })],
      [visit({ visit_id: sharedId, visit_notes: "remote" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ visit_id: sharedId, visit_notes: "remote", sync_status: "synced" });
  });

  it("queries remote visits by the authenticated UUID and bounds each page to 50", () => {
    const page = read("src/app/visits/page.tsx");
    expect(page).toContain('.eq("user_id", currentUser.user_id)');
    expect(page).toContain("const REMOTE_PAGE_SIZE = 50");
    expect(page).toContain(".range(from, to)");
    expect(page).toContain("Load More");
  });

  it("retries failed visits without removing failed evidence", () => {
    const sync = read("src/lib/fieldVisits/sync.ts");
    expect(sync).toContain('.anyOf(["pending_sync", "sync_failed"])');
    expect(sync).toContain("if (activeSync) return activeSync");
    expect(sync).toContain("confirmedVisit?.visit_id !== visit.visit_id");
    const failureBlock = sync.slice(sync.indexOf("} catch (error)"));
    expect(failureBlock).toContain('sync_status: "sync_failed"');
    expect(failureBlock).not.toContain("field_visit_media.delete");
  });

  it("removes temporary evidence only after exact remote confirmation", () => {
    const sync = read("src/lib/fieldVisits/sync.ts");
    expect(sync.indexOf("confirmedVisit?.visit_id")).toBeLessThan(sync.indexOf("field_visit_media.delete"));
    expect(sync).not.toContain('.from("field_visit_media")');
    expect(sync).toContain('.from("visits-evidence")');
    expect(sync).toContain('.upsert(payload, { onConflict: "visit_id" })');
  });

  it("registers online and visibility listeners only once and uses no polling", () => {
    const sync = read("src/lib/fieldVisits/sync.ts");
    expect(sync).toContain("listenersRegistered");
    expect(sync.match(/addEventListener\("online"/g)).toHaveLength(1);
    expect(sync.match(/addEventListener\("visibilitychange"/g)).toHaveLength(1);
    expect(sync).not.toContain("setInterval");
  });

  it("stores new captures as Blob-compatible media while preserving legacy strings", () => {
    const repository = read("src/lib/fieldVisits/repository.ts");
    const db = read("src/lib/db.ts");
    const retailer = read("src/app/visits/new/retailer/page.tsx");
    expect(repository).toContain("media: Blob | string | null");
    expect(db).toContain("media_data: Blob | string");
    expect(retailer).toContain("saveVisitWithMedia(visitRecord, photoBlob)");
    expect(retailer).not.toContain("readAsDataURL");
  });
});
