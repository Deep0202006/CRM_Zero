import { expect, test, type Page } from "@playwright/test";

const employeeId = "22000000-0000-4000-a000-000000000001";
const adminId = "22000000-0000-4000-a000-000000000002";
const otherId = "22000000-0000-4000-a000-000000000003";
const adminCallId = "23000000-0000-4000-a000-000000000001";
function token(id: string) { const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"); return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`; }

async function mockAuth(page: Page, id: string) {
  await page.route("https://e2e.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://e2e.supabase.co/auth/v1/user", (route) => route.fulfill({ json: { id, aud: "authenticated", role: "authenticated", email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
}

async function seed(page: Page, id: string, admin = false) {
  await page.goto("/login"); await page.waitForTimeout(400);
  await page.evaluate(async ({ id, admin, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = database.transaction(["users", "user_capabilities"], "readwrite");
    tx.objectStore("users").put({ user_id: id, name: admin ? "Admin Owner" : "Call Owner", email: `${id}@example.test`, is_active: 1, created_at: new Date().toISOString() });
    if (admin) tx.objectStore("user_capabilities").put({ id: `${id}-admin`, user_id: id, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id, admin, accessToken: token(id) });
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = database.transaction(["call_logs", "tasks", "sync_queue"], "readonly");
    const all = <T,>(name: string) => new Promise<T[]>((resolve) => { const query = tx.objectStore(name).getAll(); query.onsuccess = () => resolve(query.result as T[]); });
    const [calls, tasks, queue] = await Promise.all([all<Record<string, unknown>>("call_logs"), all<Record<string, unknown>>("tasks"), all<Record<string, unknown>>("sync_queue")]); database.close();
    return { calls, tasks, queue };
  });
}

test("pending offline Call edits the same insert, log ID, and follow-up intent", async ({ page, context }) => {
  await mockAuth(page, employeeId);
  await page.route("**/api/call-logs/history**", (route) => route.fulfill({ json: { calls: [], total: 0, metrics_authoritative: true, confirmed_genuine_call_ids: [], confirmed_followup_call_ids: [], confirmed_reached_call_ids: [], has_more: false } }));
  await seed(page, employeeId);
  await page.goto("/call-logs"); await context.setOffline(true);
  await page.getByPlaceholder("Search by name or username").fill("Offline Client");
  await page.getByPlaceholder("Search by name or username").press("Escape");
  await page.locator("#call-outcome").selectOption({ label: "Happy call" });
  await page.getByRole("button", { name: "Record call" }).click();
  const created = await snapshot(page); const logId = String(created.calls[0].log_id);
  expect(created.calls).toHaveLength(1);
  expect(created.queue.filter((item) => item.idempotency_key === `call-log:${logId}`)).toHaveLength(1);

  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("heading", { name: "Update call outcome" })).toBeVisible();
  await page.locator("#call-outcome").selectOption({ label: "Requested more info" });
  await page.locator("#call-notes").fill("Use the edited pending state");
  await page.getByLabel("Next follow-up date").fill("2026-09-05");
  await page.getByRole("button", { name: "Save update" }).click();
  await expect(page.getByRole("heading", { name: "Record a call outcome" })).toBeVisible();
  const edited = await snapshot(page);
  expect(edited.calls).toHaveLength(1);
  expect(edited.calls[0]).toMatchObject({ log_id: logId, outcome: "Requested more info", notes: "Use the edited pending state" });
  expect(edited.queue.filter((item) => item.idempotency_key === `call-log:${logId}`)).toHaveLength(1);
  expect(edited.queue.filter((item) => item.idempotency_key === `call-update:${logId}`)).toHaveLength(0);
  expect(edited.tasks).toHaveLength(1);

  await page.getByRole("button", { name: "Update" }).click();
  await page.locator("#call-outcome").selectOption({ label: "Happy call" });
  await expect(page.locator("#call-outcome")).toHaveValue("Happy call");
  await expect(page.getByLabel("Next follow-up date")).toHaveCount(0);
  await page.getByRole("button", { name: "Save update" }).click();
  await expect(page.getByRole("heading", { name: "Record a call outcome" })).toBeVisible();
  const cancelled = await snapshot(page);
  expect(cancelled.calls).toHaveLength(1);
  expect(cancelled.tasks).toEqual([expect.objectContaining({ is_active: false, status: "Pending" })]);
});

test("Admin can update only the Call Admin originally logged", async ({ page }) => {
  await mockAuth(page, adminId);
  let ownerCall = { log_id: adminCallId, user_id: adminId, lead_id: null, client_username: "admin-client", client_name: "Admin Client", timestamp: "2026-09-01T05:00:00.000Z", outcome: "Happy call", notes: "Original", next_followup_date: null };
  const employeeCall = { ...ownerCall, log_id: "23000000-0000-4000-a000-000000000002", user_id: otherId, client_username: "other-client", client_name: "Other Client" };
  await page.route("**/api/call-logs/history**", (route) => route.fulfill({ json: { calls: [ownerCall, employeeCall], total: 2, metrics_authoritative: true, confirmed_genuine_call_ids: [ownerCall.log_id], confirmed_followup_call_ids: [], confirmed_reached_call_ids: [ownerCall.log_id], has_more: false } }));
  let patchBody: Record<string, unknown> | null = null;
  await page.route(`**/api/call-logs/${adminCallId}`, async (route) => {
    patchBody = route.request().postDataJSON() as Record<string, unknown>;
    ownerCall = { ...ownerCall, ...patchBody };
    await route.fulfill({ json: { ok: true, code: "CALL_UPDATED", call: ownerCall } });
  });
  await seed(page, adminId, true);
  await page.goto("/call-logs");
  await expect(page.getByText("Admin Client")).toBeVisible(); await expect(page.getByText("Other Client")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update" })).toHaveCount(1);
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.locator("#call-notes")).toHaveValue("Original");
  await page.locator("#call-notes").fill("Admin creator edit");
  await page.getByRole("button", { name: "Save update" }).click();
  await expect(page.getByText("Admin creator edit")).toBeVisible();
  await expect.poll(() => patchBody).not.toBeNull();
  expect(patchBody).toMatchObject({ outcome: "Happy call", notes: "Admin creator edit" });
  expect(patchBody).not.toHaveProperty("log_id"); expect(patchBody).not.toHaveProperty("user_id"); expect(patchBody).not.toHaveProperty("timestamp");
});
