import { expect, test, type Page } from "@playwright/test";

const admin = "10000000-0000-4000-a000-000000000003";
const staff = [
  { user_id: "10000000-0000-4000-a000-000000000011", name: "Legacy Staff", capabilities: ["ret_onboarding"] },
  { user_id: "10000000-0000-4000-a000-000000000012", name: "Storage Staff", capabilities: ["dist_sales"] },
  { user_id: "10000000-0000-4000-a000-000000000013", name: "Purged Staff", capabilities: ["support"] },
  { user_id: "10000000-0000-4000-a000-000000000014", name: "No Check-in Staff", capabilities: ["support"] },
];

function token(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`;
}

async function seedAdmin(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible();
  await page.evaluate(async ({ id, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["users", "user_capabilities"], "readwrite");
    transaction.objectStore("users").put({ user_id: id, name: "Admin User", email: "admin@example.test", is_active: 1, created_at: new Date().toISOString() });
    transaction.objectStore("user_capabilities").put({ id: `${id}-cap`, user_id: id, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id: admin, accessToken: token(admin) });
}

async function mockAttendance(page: Page) {
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/admin/attendance**", (route) => route.fulfill({ json: {
    date_from: "2026-08-12",
    date_to: "2026-08-12",
    users: staff,
    attendance: [
      { attendance_id: "a-legacy", user_id: staff[0].user_id, date: "2026-08-12", clock_in: "2026-08-12T03:30:00Z", selfie_captured: false },
      { attendance_id: "a-storage", user_id: staff[1].user_id, date: "2026-08-12", clock_in: "2026-08-12T04:00:00Z", selfie_captured: true, selfie_storage_path: "attendance/exact.jpg" },
      { attendance_id: "a-purged", user_id: staff[2].user_id, date: "2026-08-12", clock_in: "2026-08-12T04:30:00Z", selfie_captured: true, selfie_purged_at: "2026-08-12T05:00:00Z", selfie_purge_state: "purged" },
    ],
  } }));
}

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "tablet", width: 820, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`attendance business state is independent from evidence on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAttendance(page);
    await seedAdmin(page);
    await page.goto("/admin/attendance");
    await page.getByLabel("Attendance date").fill("2026-08-12");
    await expect(page.getByRole("cell", { name: "Present", exact: true })).toHaveCount(3);
    await expect(page.getByRole("cell", { name: "Absent", exact: true })).toHaveCount(1);
    await expect(page.getByText("Selfie recorded", { exact: true })).toBeVisible();
    await expect(page.getByText("Selfie expired", { exact: true })).toBeVisible();
    await expect(page.getByText("Legacy/system evidence", { exact: true })).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });
}

test("date changes never resolve stale attendance as absent", async ({ page }) => {
  let staleResponseFinished = false;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/admin/attendance**", async (route) => {
    const url = new URL(route.request().url());
    const date = url.searchParams.get("date_from") ?? "";
    if (date === "2026-08-11") await new Promise((resolve) => setTimeout(resolve, 700));
    if (date === "2026-08-12") await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: {
      date_from: date,
      date_to: date,
      users: staff,
      attendance: [{ attendance_id: `attendance-${date}`, user_id: staff[0].user_id, date, clock_in: `${date}T04:00:00Z`, selfie_captured: true }],
    } });
    if (date === "2026-08-11") staleResponseFinished = true;
  });
  await seedAdmin(page);
  await page.goto("/admin/attendance");
  const picker = page.getByLabel("Attendance date");
  await picker.fill("2026-08-11");
  await expect(page.getByText("Loading authoritative attendance…")).toBeVisible();
  await picker.fill("2026-08-12");
  await expect(page.getByText("Loading authoritative attendance…")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Present", exact: true })).toHaveCount(1);
  await expect(page.getByRole("cell", { name: "Absent", exact: true })).toHaveCount(3);
  await expect.poll(() => staleResponseFinished).toBe(true);
  await expect(page.getByRole("cell", { name: "Present", exact: true })).toHaveCount(1);
});

test("stale local office capability cannot create evidence-free Attendance for a server field role", async ({ page }) => {
  const employee = "10000000-0000-4000-a000-000000000020";
  let authorityPreflights = 0;
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/attendance/mine?**", (route) => { authorityPreflights += 1; return route.fulfill({ json: { ok: true, user_id: employee, date: "2026-08-14", mode: "field_selfie", attendance: [] } }); });
  await page.goto("/login");
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const ready = database.objectStoreNames.contains("users") && database.objectStoreNames.contains("user_capabilities");
    database.close();
    return ready;
  })).toBe(true);
  await page.evaluate(async ({ id, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction(["users", "user_capabilities"], "readwrite");
    transaction.objectStore("users").put({ user_id: id, name: "Field Employee", email: "field@example.test", is_active: 1, created_at: new Date().toISOString() });
    transaction.objectStore("user_capabilities").put({ id: `${id}-stale-office`, user_id: id, capability_code: "ret_onboarding", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: "field@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id: employee, accessToken: token(employee) });
  await page.reload();
  await page.waitForURL("**/attendance");
  await expect.poll(() => authorityPreflights).toBeGreaterThan(0);
  await expect(page.getByText("Field verification")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction("sync_queue", "readonly");
    const countRequest = transaction.objectStore("sync_queue").count();
    const count = await new Promise<number>((resolve, reject) => { countRequest.onsuccess = () => resolve(countRequest.result); countRequest.onerror = () => reject(countRequest.error); });
    database.close();
    return count;
  })).toBe(0);
});
