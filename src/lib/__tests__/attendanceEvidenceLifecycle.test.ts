import fs from "node:fs";
import path from "node:path";
import { attendanceEvidencePath, retentionCutoff } from "@/lib/fieldVisits/retention";
import { INITIAL_PURGE_CUTOFF_IST, INITIAL_PURGE_CUTOFF_UTC } from "@/lib/fieldVisits/initialPurge";

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
    expect(db).toContain("await db.sync_queue.delete(item.id!)");
    const fieldBranch = route.slice(route.indexOf("const evidence = selfie as Blob"));
    expect(fieldBranch.indexOf(".storage.from(SELFIE_BUCKET).upload")).toBeLessThan(fieldBranch.indexOf('.from("attendance").insert'));
    expect(route).toContain("ATTENDANCE_ALREADY_CONFIRMED");
    expect(route).toContain("sameObject(client, path, evidence)");
    expect(route).not.toMatch(/selfie_url:\s*(selfie|raw|evidence)/);
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
