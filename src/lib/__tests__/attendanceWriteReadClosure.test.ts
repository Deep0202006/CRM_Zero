import { createClient } from "@supabase/supabase-js";
import { POST } from "@/app/api/attendance/confirm/route";
import { resolveAttendanceDay, type AttendanceAuthorityRow } from "@/lib/attendance/authority";
import { attendanceModeForCapabilities } from "@/lib/attendance/roles";
import { buildTeamKpiReport } from "@/lib/teamKpi/aggregate";
import { getCurrentISTDate } from "@/lib/dateTime";
import fs from "node:fs";
import path from "node:path";

jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/serverBackendIdentity", () => ({
  getServerBackendEnvironment: () => ({
    status: "configured",
    deployment: "production",
    reason: "AUTHORIZED_PRODUCTION",
    url: "https://fixture.invalid",
    anonKey: "fixture-public-key",
  }),
}));

const mockedCreateClient = createClient as jest.Mock;
const userId = "20000000-0000-4000-a000-000000000001";
const firstAttendanceId = "30000000-0000-4000-a000-000000000001";
const secondAttendanceId = "30000000-0000-4000-a000-000000000002";
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

function serviceFor(capabilities: string[]) {
  const attendance: AttendanceAuthorityRow[] = [];
  const uploaded: Array<{ path: string; contentType: string }> = [];
  const service = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    storage: { from: () => ({ upload: async (path: string, _evidence: Blob, options: { contentType: string }) => { uploaded.push({ path, contentType: options.contentType }); return { data: { path }, error: null }; }, download: async () => ({ data: null, error: { message: "not found" } }) }) },
    from(table: string) {
      let mode: "select" | "insert" | "update" = "select";
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const result = () => {
        if (table === "users") return { data: { user_id: userId, is_active: true }, error: null };
        if (table === "user_capabilities") return { data: capabilities.map((capability_code) => ({ capability_code })), error: null };
        if (table !== "attendance") return { data: null, error: { code: "UNEXPECTED_TABLE" } };
        if (mode === "select") {
          const row = attendance.find((candidate) => filters.every(([key, value]) => candidate[key as keyof AttendanceAuthorityRow] === value)) ?? null;
          return { data: row, error: null };
        }
        if (mode === "insert") {
          const row = payload as unknown as AttendanceAuthorityRow;
          const duplicate = attendance.find((candidate) => candidate.user_id === row.user_id && candidate.date === row.date);
          if (duplicate) return { data: null, error: { code: "23505" } };
          attendance.push(row);
          return { data: row, error: null };
        }
        const row = attendance.find((candidate) => filters.every(([key, value]) => candidate[key as keyof AttendanceAuthorityRow] === value)) ?? null;
        if (row) Object.assign(row, payload);
        return { data: row, error: null };
      };
      const query = {
        select: () => query,
        insert: (value: Record<string, unknown>) => { mode = "insert"; payload = value; return query; },
        update: (value: Record<string, unknown>) => { mode = "update"; payload = value; return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
  };
  return { service, attendance, uploaded };
}

async function submit(attendanceId: string, capabilities: string[]) {
  const state = serviceFor(capabilities);
  mockedCreateClient.mockReturnValue(state.service);
  const field = attendanceModeForCapabilities(capabilities) === "field_selfie";
  const date = getCurrentISTDate();
  const form = new FormData();
  form.set("queue_schema_version", "2");
  form.set("attendance", JSON.stringify({
    attendance_id: attendanceId,
    user_id: userId,
    date,
    clock_in: `${date}T04:00:00.000Z`,
    clock_out: null,
    selfie_url: null,
    latitude: field ? 18.5204 : null,
    longitude: field ? 73.8567 : null,
  }));
  if (field) form.set("selfie", new Blob([new Uint8Array(1024)], { type: "image/jpeg" }), "attendance.jpg");
  const response = await POST(new Request("http://localhost/api/attendance/confirm", { method: "POST", headers: { Authorization: "Bearer fixture", "X-ZeroData-Attendance-Contract": "attendance-queue-v2" }, body: form }));
  return { ...state, response, body: await response.json() as { ok?: boolean; code?: string; reason?: string; operation_id?: string; attendance_id?: string } };
}

describe("Attendance write to authoritative read closure", () => {
  const eligibleShapes = [
    ["dist_onboarding", "dist_support", "field_dist"],
    ["field_ret", "ret_onboarding", "ret_support"],
    ["dist_onboarding", "dist_support", "ret_onboarding", "ret_support"],
  ];

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-key";
    mockedCreateClient.mockReset();
  });

  test.each(eligibleShapes.map((capabilities) => [capabilities]))("closes API, employee, Admin Attendance, and Team KPI for %j", async (capabilities) => {
    const result = await submit(firstAttendanceId, capabilities);
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, code: "ATTENDANCE_CONFIRMED", operation_id: firstAttendanceId, attendance_id: firstAttendanceId });
    expect(result.attendance).toHaveLength(1);
    const date = getCurrentISTDate();
    expect(resolveAttendanceDay(result.attendance, userId, date)).toMatchObject({ present: true, duplicate_count: 0 });
    const report = buildTeamKpiReport({
      targetDate: date,
      users: [{ user_id: userId, name: "Fixture Employee", is_active: true }],
      userCapabilities: capabilities.map((capability_code) => ({ user_id: userId, capability_code })),
      capabilities: capabilities.map((code) => ({ code, label: code })),
      calls: [], clientQueries: [], mappings: [], tasks: [], taskHistory: [], allocatedTargets: [], attendance: result.attendance,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ user_id: userId, attendance_status: "Present" });
    if (attendanceModeForCapabilities(capabilities) === "field_selfie") {
      expect(result.attendance[0]).toMatchObject({ latitude: 18.5204, longitude: 73.8567, selfie_captured: true });
      expect(result.uploaded).toHaveLength(1);
      expect(result.uploaded[0].contentType).toBe("image/jpeg");
    } else {
      expect(result.attendance[0]).toMatchObject({ selfie_captured: false });
      expect(result.uploaded).toHaveLength(0);
    }
  });

  test("replay and a second-tab operation converge on exactly one canonical row", async () => {
    const capabilities = ["field_ret", "ret_onboarding", "ret_support"];
    const state = serviceFor(capabilities);
    mockedCreateClient.mockReturnValue(state.service);
    const date = getCurrentISTDate();
    const request = (id: string) => {
      const form = new FormData();
      form.set("queue_schema_version", "2");
      form.set("attendance", JSON.stringify({ attendance_id: id, user_id: userId, date, clock_in: `${date}T04:00:00.000Z`, clock_out: null, selfie_url: null, latitude: 18.5204, longitude: 73.8567 }));
      form.set("selfie", new Blob([new Uint8Array(1024)], { type: "image/jpeg" }), "attendance.jpg");
      return POST(new Request("http://localhost/api/attendance/confirm", { method: "POST", headers: { Authorization: "Bearer fixture" }, body: form }));
    };
    expect((await request(firstAttendanceId)).status).toBe(200);
    const replay = await request(firstAttendanceId);
    expect(await replay.json()).toMatchObject({ code: "ATTENDANCE_ALREADY_CONFIRMED", operation_id: firstAttendanceId, attendance_id: firstAttendanceId });
    const secondTab = await request(secondAttendanceId);
    expect(await secondTab.json()).toMatchObject({ code: "ATTENDANCE_ALREADY_CONFIRMED", operation_id: secondAttendanceId, attendance_id: firstAttendanceId });
    expect(state.attendance).toHaveLength(1);
    expect(state.uploaded).toHaveLength(1);
  });

  test.each([
    [["admin", "dist_onboarding", "dist_support"]],
    [[]],
  ])("rejects non-eligible role shape %j without a business row", async (capabilities) => {
    const result = await submit(firstAttendanceId, capabilities);
    expect(result.response.status).toBe(403);
    expect(result.body.code).toBe("ATTENDANCE_NOT_ELIGIBLE");
    expect(result.attendance).toHaveLength(0);
  });

  test("freezes exact identity, server-authoritative readers, and bounded request budgets", () => {
    const confirmation = read("src/app/api/attendance/confirm/route.ts");
    const mine = read("src/app/api/attendance/mine/route.ts");
    const admin = read("src/app/api/admin/attendance/route.ts");
    const employee = read("src/app/attendance/page.tsx");
    const gate = read("src/components/CheckInGate.tsx");
    const kpi = read("src/lib/teamKpi/serverReport.ts");
    const kpiAggregate = read("src/lib/teamKpi/aggregate.ts");
    expect(confirmation).toContain("parsed.data.user_id !== auth.data.user.id");
    expect(confirmation).toContain('.eq("user_id", auth.data.user.id)');
    expect(mine).toContain('.eq("user_id", auth.data.user.id).eq("date", requestedDate)');
    expect(mine).toContain(".limit(2)");
    expect(mine).not.toContain('select("*")');
    expect(admin).toContain("const limit = 1000");
    expect(admin).toContain("isAttendanceEligible");
    expect(admin).not.toContain('select("*")');
    expect(employee).toContain("/api/attendance/mine?date=");
    expect(gate).toContain("/api/attendance/mine?date=");
    expect(gate).not.toContain("db.attendance");
    expect(kpi).toContain('.from("attendance")');
    expect(kpiAggregate).toContain("resolveAttendanceDay");
    for (const source of [confirmation, mine, admin, employee, gate]) expect(source).not.toContain("setInterval(");
  });

  test("emits a safe typed reason and client-contract marker for a terminal validation failure", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = serviceFor(["field_ret"]);
    mockedCreateClient.mockReturnValue(state.service);
    const form = new FormData();
    form.set("queue_schema_version", "2");
    form.set("attendance", JSON.stringify({
      attendance_id: firstAttendanceId,
      user_id: userId,
      date: "2000-01-02",
      clock_in: "2000-01-01T04:00:00.000Z",
      clock_out: null,
      selfie_url: null,
      latitude: 18.5204,
      longitude: 73.8567,
    }));
    const response = await POST(new Request("http://localhost/api/attendance/confirm", {
      method: "POST",
      headers: { Authorization: "Bearer fixture", "X-ZeroData-Attendance-Contract": "attendance-queue-v2" },
      body: form,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "ATTENDANCE_VALIDATION_FAILED", reason: "IST_CAPTURE_DATE_MISMATCH" });
    expect(warning).toHaveBeenCalledWith("ATTENDANCE_CONFIRM_FAILURE", expect.objectContaining({
      operation_id: firstAttendanceId,
      client_contract: "attendance-queue-v2",
      queue_schema_version: "2",
      stage: "business_date",
      reason: "IST_CAPTURE_DATE_MISMATCH",
    }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain(userId);
    warning.mockRestore();
  });

  test("confirms an authentic two-day queued field operation on its original IST business date", async () => {
    const state = serviceFor(["field_ret", "ret_onboarding", "ret_support"]);
    mockedCreateClient.mockReturnValue(state.service);
    const form = new FormData();
    form.set("queue_schema_version", "2");
    form.set("attendance", JSON.stringify({
      attendance_id: firstAttendanceId,
      user_id: userId,
      date: "2026-08-12",
      clock_in: "2026-08-11T18:30:00.000Z",
      clock_out: null,
      selfie_url: null,
      latitude: 18.5204,
      longitude: 73.8567,
    }));
    form.set("selfie", new Blob([new Uint8Array(1024)], { type: "image/jpeg" }), "attendance.jpg");
    const response = await POST(new Request("http://localhost/api/attendance/confirm", {
      method: "POST",
      headers: { Authorization: "Bearer fixture", "X-ZeroData-Attendance-Contract": "attendance-queue-v2" },
      body: form,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "ATTENDANCE_CONFIRMED", operation_id: firstAttendanceId });
    expect(state.attendance).toHaveLength(1);
    expect(state.attendance[0]).toMatchObject({ date: "2026-08-12", clock_in: "2026-08-11T18:30:00.000Z", selfie_captured: true });
    expect(state.uploaded).toHaveLength(1);
  });

  test("classifies a current field payload without location as a typed terminal failure", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = serviceFor(["field_ret", "ret_onboarding"]);
    mockedCreateClient.mockReturnValue(state.service);
    const date = getCurrentISTDate();
    const form = new FormData();
    form.set("queue_schema_version", "2");
    form.set("attendance", JSON.stringify({ attendance_id: firstAttendanceId, user_id: userId, date, clock_in: `${date}T04:00:00.000Z`, clock_out: null, selfie_url: null, latitude: null, longitude: null }));
    form.set("selfie", new Blob([new Uint8Array(1024)], { type: "image/jpeg" }), "attendance.jpg");
    const response = await POST(new Request("http://localhost/api/attendance/confirm", { method: "POST", headers: { Authorization: "Bearer fixture", "X-ZeroData-Attendance-Contract": "attendance-queue-v2" }, body: form }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "ATTENDANCE_LOCATION_REQUIRED", reason: "LOCATION_REQUIRED" });
    expect(state.attendance).toHaveLength(0);
    warning.mockRestore();
  });
});
