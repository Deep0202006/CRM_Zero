import { expect, test, type Page } from "@playwright/test";
import { getCurrentISTDate } from "../../src/lib/dateTime";

const employeeId = "20000000-0000-4000-a000-000000000021";
const adminId = "20000000-0000-4000-a000-000000000099";
const attendanceId = "30000000-0000-4000-a000-000000000021";
const today = getCurrentISTDate();

function token(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`;
}

async function seedRole(page: Page, capabilities: string[]) {
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible();
  await page.evaluate(async ({ employeeId, adminId, attendanceId, today, capabilities, employeeToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction(["users", "user_capabilities", "attendance"], "readwrite");
    transaction.objectStore("users").put({ user_id: employeeId, name: "Closure Employee", email: "employee@example.test", is_active: 1, created_at: new Date().toISOString() });
    transaction.objectStore("users").put({ user_id: adminId, name: "Closure Admin", email: "admin@example.test", is_active: 1, created_at: new Date().toISOString() });
    capabilities.forEach((capability, index) => transaction.objectStore("user_capabilities").put({ id: `${employeeId}-${index}`, user_id: employeeId, capability_code: capability, assigned_at: new Date().toISOString() }));
    transaction.objectStore("user_capabilities").put({ id: `${adminId}-admin`, user_id: adminId, capability_code: "admin", assigned_at: new Date().toISOString() });
    transaction.objectStore("attendance").put({ attendance_id: attendanceId, user_id: employeeId, date: today, clock_in: `${today}T04:00:00.000Z`, clock_out: null, selfie_captured: capabilities.includes("field_dist") || capabilities.includes("field_ret") });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", employeeId);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: employeeToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: employeeId, aud: "authenticated", role: "authenticated", email: "employee@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { employeeId, adminId, attendanceId, today, capabilities, employeeToken: token(employeeId) });
}

async function becomeAdmin(page: Page) {
  await page.evaluate(({ adminId, adminToken }) => {
    localStorage.setItem("authenticated_user_id", adminId);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: adminToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { adminId, adminToken: token(adminId) });
  await page.goto("/login");
  await page.waitForURL("**/attendance");
}

async function mockClosure(page: Page, capabilities: string[]) {
  const attendance = [{ attendance_id: attendanceId, user_id: employeeId, date: today, clock_in: `${today}T04:00:00.000Z`, clock_out: null, selfie_captured: capabilities.includes("field_dist") || capabilities.includes("field_ret") }];
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    if (route.request().url().includes("/auth/v1/user")) {
      const bearer = route.request().headers().authorization?.replace(/^Bearer\s+/i, "") ?? token(employeeId);
      const id = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).sub as string;
      return route.fulfill({ json: { id, aud: "authenticated", role: "authenticated", email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/attendance/mine**", route => route.fulfill({ json: { ok: true, date: today, user_id: employeeId, mode: capabilities.some((item) => item.startsWith("field_")) ? "field_selfie" : "office_auto", attendance } }));
  await page.route("**/api/admin/attendance**", route => route.fulfill({ json: { date_from: today, date_to: today, users: [{ user_id: employeeId, name: "Closure Employee", capabilities }], attendance } }));
  await page.route("**/api/team-kpi", route => route.fulfill({ json: { target_date: today, generated_at: new Date().toISOString(), rows: [{ user_id: employeeId, name: "Closure Employee", role: capabilities.join(" · "), capabilities, calls_made: 0, followup_calls: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0, total_completed_work: 0, latest_activity_time: null, attendance_status: "Present" }], totals: { team_members: 1, calls_made: 0, followup_calls: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0, total_completed_work: 0 }, source: "server-aggregation", warnings: [] } }));
}

for (const capabilities of [
  ["dist_onboarding", "dist_support", "field_dist"],
  ["field_ret", "ret_onboarding", "ret_support"],
  ["dist_onboarding", "dist_support", "ret_onboarding", "ret_support"],
]) {
  test(`authoritative Attendance closes across employee, Admin, and KPI for ${capabilities.join("+")}`, async ({ page }) => {
    await mockClosure(page, capabilities);
    await seedRole(page, capabilities);
    await page.goto("/attendance");
    await expect(page.getByRole("heading", { name: "Attendance confirmed" })).toBeVisible();
    await becomeAdmin(page);
    await page.goto("/admin/attendance");
    await expect(page.getByRole("cell", { name: "Present", exact: true })).toHaveCount(1);
    await page.goto("/manager/kpi");
    await expect(page.getByRole("cell", { name: "Present", exact: true })).toHaveCount(1);
  });
}
