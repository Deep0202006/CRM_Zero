import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("simple verified clock-out contract", () => {
  const route = read("src/app/api/attendance/clock-out/route.ts");
  const auth = read("src/context/AuthContext.tsx");
  const modal = read("src/components/VerifiedLogoutModal.tsx");
  const attendance = read("src/app/admin/attendance/page.tsx");

  test("requires bearer authentication and scopes the update to the authenticated user", () => {
    expect(route).toContain('request.headers.get("authorization")');
    expect(route).toContain('.eq("attendance_id", attendance.attendance_id)');
    expect(route).toContain('.eq("user_id", userId)');
    expect(route).toContain('.is("clock_out", null)');
  });

  test("field staff require a small JPEG or WebP while admins skip personal attendance", () => {
    expect(route).toContain('capabilities.has("admin")');
    expect(route).toContain('capabilities.has("field_ret") || capabilities.has("field_dist")');
    expect(route).toContain("A fresh logout selfie is required.");
    expect(route).toContain('new Set(["image/jpeg", "image/webp"])');
    expect(route).toContain("350 * 1024");
    expect(route).toContain("hasValidImageSignature");
    expect(route).toContain('String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"');
  });

  test("retry returns an existing confirmed clock-out and never overwrites clock-in evidence", () => {
    expect(route).toMatch(/if \(attendance\.clock_out\)[\s\S]*NextResponse\.json\(attendance/);
    expect(route.indexOf("if (isFieldStaff)")).toBeLessThan(route.indexOf("if (attendance.clock_out)"));
    expect(route).toContain(".update({ clock_out: clockOut })");
    expect(route).not.toContain("selfie_url:");
  });

  test("logout selfie remains request-only and is never stored or uploaded", () => {
    expect(route).not.toMatch(/storage\s*\./);
    expect(route).not.toContain("field_visit_media");
    expect(modal).not.toContain("db.field_visit_media");
    expect(modal).not.toContain("input type=\"file\"");
  });

  test("pending work remains owned and does not prevent sign-out", () => {
    expect(auth).toContain('localStorage.setItem("zerodata_outbox_owner_id", currentUser.user_id)');
    expect(auth).toContain("await supabase.auth.signOut()");
    expect(auth).not.toContain("Logout postponed because unsynchronized work remains.");
    expect(auth).toContain('if (!pendingRetained) localStorage.removeItem("zerodata_outbox_owner_id")');
    expect(auth).toContain("queuedOperations.length > 0 || pendingLocalVisits.length > 0");
    expect(auth).toContain("...pendingLocalVisits.map((visit) => visit.user_id)");
  });

  test("clock-out is confirmed before signOut and IndexedDB is never cleared", () => {
    const logoutFlow = auth.slice(auth.indexOf("const logout = async"));
    expect(logoutFlow.indexOf('fetch("/api/attendance/clock-out"')).toBeLessThan(logoutFlow.indexOf("await supabase.auth.signOut()"));
    expect(auth).toContain("await db.attendance.update(result.attendance_id");
    expect(auth).not.toMatch(/db\.(delete|clear)\s*\(/);
  });

  test("browser close cannot create clock-out", () => {
    expect(auth).not.toMatch(/pagehide|beforeunload|sendBeacon/);
    expect(modal).toContain("Closing the browser does not complete attendance.");
  });

  test("admin attendance uses server business rows and separates evidence", () => {
    expect(attendance).toContain("/api/admin/attendance?date_from=");
    expect(attendance).toContain("resolveAttendanceDay");
    expect(attendance).toContain('resolved.present ? "Present" : "Absent"');
    expect(attendance).toContain("Selfie expired");
    expect(attendance).not.toContain("Selfie URL");
    expect(attendance).not.toContain('a.selfie_url || ""');
    expect(attendance).toContain('timeZone: "Asia/Kolkata"');
    expect(attendance).not.toContain("db.attendance");
  });

  test("no migration or SQL implements this feature", () => {
    const migrationFiles = fs.existsSync(path.join(process.cwd(), "supabase", "migrations"))
      ? fs.readdirSync(path.join(process.cwd(), "supabase", "migrations"))
      : [];
    expect(migrationFiles.some((file) => /clock.?out|verified.?logout/i.test(file))).toBe(false);
    expect(route).not.toMatch(/\b(delete|truncate)\b/i);
  });
});
