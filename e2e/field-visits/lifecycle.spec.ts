import { expect, test, type Page } from "@playwright/test";
import { getCurrentISTDate } from "../../src/lib/dateTime";

const adminId = "10000000-0000-4000-a000-000000000001";
const employeeId = "20000000-0000-4000-a000-000000000001";
const leadId = "30000000-0000-4000-a000-000000000001";
const attendanceId = "40000000-0000-4000-a000-000000000001";
const today = getCurrentISTDate();
function token(id: string) { const e = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"); return `${e({ alg: "none" })}.${e({ sub: id, exp: 1999999999 })}.e2e`; }

async function seed(page: Page, role: "admin" | "employee", withAttendance = true) {
  const id = role === "admin" ? adminId : employeeId;
  await page.goto("/login");
  await page.waitForTimeout(500);
  await page.evaluate(async ({ id, role, accessToken, leadId, attendanceId, today, withAttendance }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const names = ["users", "user_capabilities", "leads", ...(withAttendance ? ["attendance"] : [])];
    const tx = database.transaction(names, "readwrite");
    tx.objectStore("users").put({ user_id: id, name: role === "admin" ? "Admin User" : "Field Employee", email: `${role}@example.test`, is_active: 1, created_at: new Date().toISOString() });
    const caps = tx.objectStore("user_capabilities");
    const codes = role === "admin" ? ["admin"] : ["field_ret", "field_dist"];
    codes.forEach((code, index) => caps.put({ id: `${id}-${index}`, user_id: id, capability_code: code, assigned_at: new Date().toISOString() }));
    tx.objectStore("leads").put({ lead_id: leadId, business_name: "Unicode व्यवसाय", contact_person: "Owner", phone: "999", segment_type: "Distributor", status: "Active", assigned_to: id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (withAttendance) tx.objectStore("attendance").put({ attendance_id: attendanceId, user_id: id, date: today, clock_in: new Date().toISOString(), clock_out: null, selfie_url: null });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: `${role}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id, role, accessToken: token(id), leadId, attendanceId, today, withAttendance });
}

async function mockSupabase(page: Page, userId = employeeId, withAttendance = true) {
  await page.route("https://e2e.supabase.co/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://e2e.supabase.co/auth/v1/user", route => route.fulfill({ json: { id: userId, aud: "authenticated", role: "authenticated", email: "employee@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  await page.route("**/api/attendance/mine**", route => route.fulfill({ json: { ok: true, date: today, user_id: userId, mode: "field_selfie", attendance: withAttendance ? [{ attendance_id: attendanceId, user_id: userId, date: today, clock_in: new Date().toISOString(), clock_out: null, selfie_captured: true }] : [] } }));
}

test("Admin Visits Overview is bounded, responsive, legacy-safe, and loads evidence only on click", async ({ page }) => {
  await mockSupabase(page, adminId); await seed(page, "admin");
  let evidenceRequests = 0;
  await page.route("**/api/admin/visits/evidence**", route => { evidenceRequests++; return route.fulfill({ json: { url: "https://example.test/selfie.jpg" } }); });
  await page.route("**/api/admin/visits**", route => route.fulfill({ json: { visits: [
    { visit_id: "50000000-0000-4000-a000-000000000001", user_id: employeeId, lead_id: leadId, visit_date: today, check_in_time: "2026-08-12T05:00:00Z", check_in_lat: 18.52, check_in_lng: 73.85, address: "१२ मुख्य सड़क\nपुणे", pincode: "012345", visit_outcome: "payment_done", visit_notes: "Full multiline\nnotes remain readable", person_met: "Priya", segment_type: "Distributor", follow_up_date: null, sync_status: "synced", selfie_status: "AVAILABLE", has_selfie_evidence: true, users: { name: "Field Employee", email: "employee@example.test" }, leads: { business_name: "Unicode व्यवसाय" } },
    { visit_id: "50000000-0000-4000-a000-000000000002", user_id: employeeId, lead_id: "legacy", visit_date: "2026-08-01", check_in_time: "2026-08-01T05:00:00Z", address: null, pincode: null, visit_outcome: "interested", person_met: "Owner", segment_type: "Retailer", selfie_status: "PURGED", users: { name: "Field Employee" }, leads: { business_name: "Legacy Store" } },
  ], page: 1, page_size: 50, total: 2, all_time_total: 2, today_total: 1, has_more: false, representatives: [{ user_id: employeeId, name: "Field Employee", email: "employee@example.test", is_active: true, capabilities: ["field_dist"], historical_only: false }] } }));
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport); await page.goto("/admin/visits");
    await expect(page.getByRole("heading", { name: "VISITS OVERVIEW" })).toBeVisible();
    await expect(page.getByText("१२ मुख्य सड़क")).toBeVisible();
    await expect(page.getByText("Legacy visit — address was not captured")).toBeVisible();
    await expect(page.getByText("Selfie expired after 5-day retention")).toBeVisible();
    await page.getByText("Visit detail").first().click();
    await expect(page.getByText(/Pincode:\s*012345/)).toBeVisible();
    expect(evidenceRequests).toBe(0);
  }
  await page.getByRole("button", { name: "View Selfie" }).click();
  await expect.poll(() => evidenceRequests).toBe(1);
  await expect(page.getByLabel("Date From")).toBeVisible(); await expect(page.getByLabel("Date To")).toBeVisible();
});

test("Distributor form requires Unicode address and offers observational Payment done", async ({ page, context }) => {
  await mockSupabase(page); await seed(page, "employee");
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:3111" }); await context.setGeolocation({ latitude: 18.52, longitude: 73.85, accuracy: 15 });
  await page.goto("/visits/new/distributor");
  await expect(page.getByRole("option", { name: "Payment done" })).toHaveCount(1);
  await expect(page.getByLabel("Address *")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Pincode *")).toHaveAttribute("required", "");
  await page.getByLabel("Address *").fill("१२ मुख्य सड़क, पुणे");
  await expect(page.getByLabel("Address *")).toHaveValue("१२ मुख्य सड़क, पुणे");
});

test("Retailer form labels address authority as Area, requires pincode, and never exposes Payment done", async ({ page, context }) => {
  await mockSupabase(page); await seed(page, "employee");
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:3111" }); await context.setGeolocation({ latitude: 18.52, longitude: 73.85, accuracy: 15 });
  await page.goto("/visits/new/retailer");
  await expect(page.getByLabel("Area *")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Pincode *")).toHaveAttribute("required", "");
  await expect(page.getByRole("option", { name: "Payment done" })).toHaveCount(0);
});

test("offline attendance stores a Blob outbox with no embedded row payload and later confirms same ID", async ({ page, context }) => {
  await mockSupabase(page, employeeId, false);
  await context.grantPermissions(["geolocation"], { origin: "http://127.0.0.1:3111" });
  await context.setGeolocation({ latitude: 18.5204, longitude: 73.8567, accuracy: 12 });
  await page.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 480 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
    HTMLMediaElement.prototype.play = async () => undefined;
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => new MediaStream() } });
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function(callback) { callback(new Blob([new Uint8Array(1024)], { type: "image/jpeg" })); };
  });
  await seed(page, "employee", false); await page.goto("/attendance"); await context.setOffline(true);
  await page.getByRole("button", { name: "Capture selfie and clock in" }).click();
  const offline = await page.evaluate(async () => {
    const request = indexedDB.open("CRMDatabase"); const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(["attendance", "sync_queue"], "readonly");
    const row = await new Promise<Record<string, unknown>>((resolve) => { const q = tx.objectStore("attendance").getAll(); q.onsuccess = () => resolve(q.result[0] as Record<string, unknown>); });
    const queue = await new Promise<{ data?: Record<string, unknown> } | undefined>((resolve) => { const q = tx.objectStore("sync_queue").getAll(); q.onsuccess = () => resolve((q.result as Array<{ table_name?: string; data?: Record<string, unknown> }>).find((item) => item.table_name === "attendance")); });
    return { row, hasBlob: queue?.data?.selfie_blob instanceof Blob, queuedId: queue?.data?.attendance_id, queueVersion: (queue as { queue_schema_version?: number } | undefined)?.queue_schema_version };
  });
  expect(offline.row.selfie_url).toBeNull(); expect(offline.row.selfie_captured).toBe(true); expect(offline.row.latitude).toBe(18.5204); expect(offline.row.longitude).toBe(73.8567); expect(offline.hasBlob).toBe(true); expect(offline.queuedId).toBe(offline.row.attendance_id); expect(offline.queueVersion).toBe(2);
  await page.route("**/api/attendance/confirm", async route => { const id = offline.row.attendance_id; await route.fulfill({ json: { ok: true, code: "ATTENDANCE_CONFIRMED", attendance_id: id, attendance: { attendance_id: id, user_id: employeeId, date: today, clock_in: offline.row.clock_in, clock_out: null, selfie_captured: true, selfie_storage_path: `attendance/${employeeId}/${today}/${id}.jpg`, selfie_uploaded_at: new Date().toISOString(), selfie_purged_at: null } } }); });
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await page.waitForURL("**/my-day"); await page.reload(); await page.waitForTimeout(1000);
  const after = await page.evaluate(async () => { const request = indexedDB.open("CRMDatabase"); const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); const tx = db.transaction(["attendance", "sync_queue"], "readonly"); const rows = await new Promise<Array<Record<string, unknown>>>((resolve) => { const q = tx.objectStore("attendance").getAll(); q.onsuccess = () => resolve(q.result as Array<Record<string, unknown>>); }); const queue = await new Promise<Array<{ table_name?: string }>>((resolve) => { const q = tx.objectStore("sync_queue").getAll(); q.onsuccess = () => resolve(q.result as Array<{ table_name?: string }>); }); return { row: rows[0], attendanceQueue: queue.filter(item => item.table_name === "attendance").length, queue }; });
  expect(after.attendanceQueue, JSON.stringify(after)).toBe(0); expect(after.row.attendance_id).toBe(offline.row.attendance_id); expect(after.row.selfie_storage_path).toContain(offline.row.attendance_id);
});
