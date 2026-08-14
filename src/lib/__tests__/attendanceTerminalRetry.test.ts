import { shouldAttemptSyncQueueItem, type SyncQueueItem } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const base: SyncQueueItem = {
  id: 1,
  idempotency_key: "attendance:30000000-0000-4000-a000-000000000001",
  owner_user_id: "20000000-0000-4000-a000-000000000001",
  table_name: "attendance",
  action: "INSERT",
  data: {},
  timestamp: "2026-08-14T12:00:00.000Z",
};

describe("Attendance terminal queue selection", () => {
  test("passive terminal evidence is never selected by a later queue pass", () => {
    expect(shouldAttemptSyncQueueItem({ ...base, recovery_state: "review_required", next_retry_at: undefined }, Date.parse("2026-08-14T13:00:00.000Z"))).toBe(false);
    expect(shouldAttemptSyncQueueItem({ ...base, recovery_state: "quarantined" }, Date.parse("2026-08-14T13:00:00.000Z"))).toBe(false);
  });

  test("transient backoff stays bounded while due active work remains selectable", () => {
    const now = Date.parse("2026-08-14T13:00:00.000Z");
    expect(shouldAttemptSyncQueueItem({ ...base, next_retry_at: "2026-08-14T13:01:00.000Z" }, now)).toBe(false);
    expect(shouldAttemptSyncQueueItem({ ...base, next_retry_at: "2026-08-14T12:59:00.000Z" }, now)).toBe(true);
  });

  test("direct confirmation and background drains share one cross-tab lock", () => {
    const database = read("src/lib/db.ts");
    expect(database).toContain('SYNC_QUEUE_BROWSER_LOCK = "zerodata-sync-queue-v1"');
    expect(database).toContain("withSyncQueueBrowserLock(() => confirmQueuedAttendanceInternal(attendanceId))");
    expect(database).toContain("activeSyncQueueRun = withSyncQueueBrowserLock(async () =>");
    expect(database).toContain("if (!shouldAttemptSyncQueueItem(item)) continue");
  });

  test("office auto-attendance requires the server-authoritative role mode before durable save", () => {
    const auth = read("src/context/AuthContext.tsx");
    const authority = auth.indexOf('fetch(`/api/attendance/mine?date=${todayStr}`');
    const mode = auth.indexOf('authority.mode !== "office_auto"', authority);
    const save = auth.indexOf("saveAttendanceWithEvidence(newRecord, null)", authority);
    expect(authority).toBeGreaterThan(0);
    expect(mode).toBeGreaterThan(authority);
    expect(save).toBeGreaterThan(mode);
  });
});
