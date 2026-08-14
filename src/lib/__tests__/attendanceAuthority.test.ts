import fs from "node:fs";
import path from "node:path";
import { attendanceEvidenceState, resolveAttendanceDay, type AttendanceAuthorityRow } from "@/lib/attendance/authority";
import { getISTDateKey } from "@/lib/dateTime";

const base: AttendanceAuthorityRow = {
  attendance_id: "10000000-0000-4000-a000-000000000001", user_id: "20000000-0000-4000-a000-000000000001",
  date: "2026-08-12", clock_in: "2026-08-11T18:30:00.000Z", clock_out: null,
};

describe("attendance business authority", () => {
  test.each([
    ["legacy evidence", { ...base, selfie_captured: false }],
    ["Storage evidence", { ...base, selfie_storage_path: `attendance/${base.user_id}/${base.date}/${base.attendance_id}.jpg`, selfie_captured: true }],
    ["purged evidence", { ...base, selfie_purged_at: "2026-08-17T18:30:00.000Z", selfie_purge_state: "purged" }],
    ["no current image", { ...base }],
  ])("%s remains Present", (_label, row) => {
    expect(resolveAttendanceDay([row], base.user_id, base.date).present).toBe(true);
  });

  test("no confirmed row is Absent and evidence is orthogonal", () => {
    expect(resolveAttendanceDay([], base.user_id, base.date).present).toBe(false);
    expect(attendanceEvidenceState({ ...base, selfie_purged_at: "2026-08-17T18:30:00Z" })).toBe("purged");
  });

  test("IST midnight boundaries stay on the authoritative business day", () => {
    expect(getISTDateKey("2026-08-11T18:29:00.000Z")).toBe("2026-08-11");
    expect(getISTDateKey("2026-08-11T18:30:00.000Z")).toBe("2026-08-12");
    expect(getISTDateKey("2026-08-11T18:31:00.000Z")).toBe("2026-08-12");
  });

  test("duplicates are preserved and resolved deterministically without double-counting", () => {
    const later = { ...base, attendance_id: "10000000-0000-4000-a000-000000000002", clock_in: "2026-08-11T18:31:00.000Z", clock_out: "2026-08-12T10:00:00.000Z" };
    expect(resolveAttendanceDay([later, base], base.user_id, base.date)).toMatchObject({ present: true, attendance_ids: [base.attendance_id, later.attendance_id], duplicate_count: 1, clock_in: base.clock_in, clock_out: later.clock_out });
  });

  test("admin API is bounded, explicit, and never hydrates embedded selfie payload", () => {
    const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/admin/attendance/route.ts"), "utf8");
    expect(route).toContain("ATTENDANCE_RANGE_TOO_LARGE");
    expect(route).toContain("const limit = 1000");
    expect(route).toContain(".range(0, limit - 1)");
    expect(route).toContain("ATTENDANCE_REGISTER_LIMIT_EXCEEDED");
    expect(route).toContain('select("attendance_id,user_id,date,clock_in,clock_out,latitude,longitude,selfie_captured,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_purge_state", { count: "exact" })');
    expect(route).not.toContain("selfie_url");
    expect(route).not.toContain('select("*")');
  });
});
