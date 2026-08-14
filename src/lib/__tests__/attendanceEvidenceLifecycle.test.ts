import fs from "node:fs";
import path from "node:path";
import { attendanceEvidencePath, retentionCutoff } from "@/lib/fieldVisits/retention";
import { INITIAL_PURGE_CUTOFF_IST, INITIAL_PURGE_CUTOFF_UTC } from "@/lib/fieldVisits/initialPurge";
import {
  ATTENDANCE_QUEUE_SCHEMA_VERSION,
  normalizeAttendanceConfirmationPayload,
  parseAttendanceQueueSchemaVersion,
  prepareSyncPayload,
  serializeAttendanceQueuePayload,
} from "@/lib/syncPayload";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("attendance evidence lifecycle", () => {
  test("uses stable exact private keys and the frozen owner cutoff", () => {
    expect(attendanceEvidencePath("user", "2026-08-12", "attendance")).toBe("attendance/user/2026-08-12/attendance.jpg");
    expect(INITIAL_PURGE_CUTOFF_IST).toBe("2026-08-11 23:59:59 Asia/Kolkata");
    expect(INITIAL_PURGE_CUTOFF_UTC).toBe("2026-08-11T18:29:59.000Z");
  });

  test("freezes under-boundary, exact-boundary, expired, and future semantics", () => {
    const now = new Date("2026-08-12T12:00:00.000Z");
    const cutoff = new Date(retentionCutoff(now));
    expect(new Date("2026-08-07T12:00:01.000Z") <= cutoff).toBe(false);
    expect(new Date("2026-08-07T12:00:00.000Z") <= cutoff).toBe(true);
    expect(new Date("2026-08-07T11:59:59.000Z") <= cutoff).toBe(true);
    expect(new Date("2026-08-13T00:00:00.000Z") <= cutoff).toBe(false);
  });

  test("new and legacy queued attendance converge on stable-ID server confirmation", () => {
    const db = read("src/lib/db.ts");
    const route = read("src/app/api/attendance/confirm/route.ts");
    expect(db).toContain("saveAttendanceWithEvidence");
    expect(db).toContain('idempotency_key: `attendance:${attendance.attendance_id}`');
    expect(db).toContain("payload.selfie_blob ?? payload.selfie_url");
    expect(db).toContain('fetch("/api/attendance/confirm"');
    expect(db).toContain('"X-ZeroData-Attendance-Contract": "attendance-queue-v2"');
    expect(db).toContain("if (item.id) await db.sync_queue.delete(item.id)");
    const fieldBranch = route.slice(route.indexOf("const evidence = selfie as Blob"));
    expect(fieldBranch.indexOf(".storage.from(SELFIE_BUCKET).upload")).toBeLessThan(fieldBranch.indexOf('.from("attendance").insert'));
    expect(route).toContain("ATTENDANCE_ALREADY_CONFIRMED");
    expect(route).toContain("sameObject(client, path, evidence)");
    expect(route).not.toMatch(/selfie_url:\s*(selfie|raw|evidence)/);
  });

  test("current and legacy evidence metadata are repaired without losing business identity or evidence", () => {
    const payload = {
      attendance_id: "00000000-0000-4000-8000-000000000001", user_id: "00000000-0000-4000-8000-000000000002",
      date: "2026-08-14", clock_in: "2026-08-14T04:00:00.000Z", selfie_url: "data:image/jpeg;base64,AA==",
      selfie_captured: true, selfie_storage_path: "attendance/old/key.jpg", selfie_uploaded_at: "2026-08-14T04:00:00.000Z",
    };
    const repaired = normalizeAttendanceConfirmationPayload(payload);
    expect(repaired.changed).toBe(true);
    expect(repaired.data).toMatchObject({ attendance_id: payload.attendance_id, user_id: payload.user_id, date: payload.date, selfie_url: payload.selfie_url });
    expect(repaired.data).not.toHaveProperty("selfie_captured");
    expect(repaired.data).not.toHaveProperty("selfie_storage_path");
    expect(read("src/lib/db.ts")).toContain("const prepared = prepareSyncPayload(item.table_name, item.data)");
    expect(read("src/lib/db.ts")).toContain('recovery_state: "review_required"');
  });

  test("versions current queues and upgrades the previous persisted envelope", () => {
    const payload = {
      attendance_id: "00000000-0000-4000-8000-000000000001",
      user_id: "00000000-0000-4000-8000-000000000002",
      date: "2026-08-14",
      clock_in: "2026-08-14T04:00:00.000Z",
      selfie_captured: true,
      selfie_url: null,
    };
    const evidence = new Blob([new Uint8Array(32)], { type: "image/jpeg" });
    const current = serializeAttendanceQueuePayload(payload, evidence);
    expect(current).toMatchObject({ attendance_id: payload.attendance_id, selfie_url: null, selfie_blob: evidence });
    expect(current).not.toHaveProperty("selfie_captured");
    expect(prepareSyncPayload("attendance", current, ATTENDANCE_QUEUE_SCHEMA_VERSION)).toMatchObject({ changed: false, supported: true, queueSchemaVersion: ATTENDANCE_QUEUE_SCHEMA_VERSION });

    const previous = prepareSyncPayload("attendance", { ...payload, selfie_url: "data:image/jpeg;base64,AA==" });
    expect(previous).toMatchObject({ changed: true, supported: true, queueSchemaVersion: ATTENDANCE_QUEUE_SCHEMA_VERSION });
    expect(previous.data).toMatchObject({ attendance_id: payload.attendance_id, selfie_url: "data:image/jpeg;base64,AA==" });
    expect(previous.data).not.toHaveProperty("selfie_captured");
    expect(prepareSyncPayload("attendance", current, 99)).toMatchObject({ changed: false, supported: false, queueSchemaVersion: 99 });
    expect(parseAttendanceQueueSchemaVersion(null)).toBe(1);
    expect(parseAttendanceQueueSchemaVersion("2")).toBe(2);
    expect(parseAttendanceQueueSchemaVersion("99")).toBeNull();
  });

  test("unsupported Attendance envelopes stop before HTTP and preserve review evidence", () => {
    const db = read("src/lib/db.ts");
    const unsupported = db.indexOf('recovery_reason: "UNSUPPORTED_ATTENDANCE_QUEUE_SCHEMA"');
    const confirmation = db.indexOf("const confirmed = await confirmAttendance", unsupported);
    expect(unsupported).toBeGreaterThan(0);
    expect(db.slice(unsupported, confirmation)).toMatch(/return \{ status: "review_required"|continue;/);
    expect(db).toContain("queue_schema_version: ATTENDANCE_QUEUE_SCHEMA_VERSION");
  });

  test("ordinary hydration cannot carry legacy embedded payloads", () => {
    const db = read("src/lib/db.ts");
    const hydration = db.match(/const HYDRATION_COLUMNS[\s\S]*?};/)?.[0] ?? "";
    expect(hydration).toContain("attendance_id,user_id,date,clock_in,clock_out");
    expect(hydration).not.toContain("selfie_url");
  });

  test("retention and initial purge preserve rows and exact scope", () => {
    const retention = read("src/lib/fieldVisits/retention.ts");
    const initial = read("src/lib/fieldVisits/initialPurge.ts");
    expect(retention).toContain('selfie_purge_state: "purge_pending"');
    expect(retention).toContain('selfie_purge_state: "purged"');
    expect(retention).not.toMatch(/\.delete\(|delete\s+from|storage\.objects/i);
    expect(initial).toContain("candidate.path !== expected");
    expect(initial).toContain("selfie_url: null, selfie_captured: true");
    expect(initial).toContain('.eq("attendance_id", row.attendance_id)');
    expect(initial).not.toMatch(/\.delete\(|delete\s+from|storage\.objects/i);
  });

  test("payment_done has no cross-domain mutation path", () => {
    const sources = ["src/app/api/field-visits/confirm/route.ts", "src/lib/fieldVisits/sync.ts", "src/app/visits/new/distributor/page.tsx"].map(read).join("\n");
    expect(sources).toContain('value: "payment_done"');
    expect(sources).not.toMatch(/from\(["'](?:receivables|receivable_payments|lead_payment_details|pipeline_transition_operations|call_logs|tasks)["']\)/);
  });
});
