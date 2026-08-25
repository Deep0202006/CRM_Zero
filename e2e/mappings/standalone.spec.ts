import { expect, test, type Page } from "@playwright/test";

const employeeId = "20000000-0000-4000-a000-000000000010";
function token(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`;
}

async function seedSupportEmployee(page: Page) {
  await page.goto("/login");
  await page.waitForTimeout(500);
  await page.evaluate(async ({ id, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = database.transaction(["users", "user_capabilities"], "readwrite");
    tx.objectStore("users").put({ user_id: id, name: "Support Employee", email: "support@example.test", is_active: 1, created_at: new Date().toISOString() });
    tx.objectStore("user_capabilities").put({ id: `${id}-support`, user_id: id, capability_code: "ret_support", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: "support@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id: employeeId, accessToken: token(employeeId) });
}

async function mappingSnapshot(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = database.transaction(["mapping_requests", "leads", "sync_queue"], "readonly");
    const all = <T,>(store: string) => new Promise<T[]>((resolve) => { const query = tx.objectStore(store).getAll(); query.onsuccess = () => resolve(query.result as T[]); });
    const [mappings, leads, queue] = await Promise.all([all<Record<string, unknown>>("mapping_requests"), all<Record<string, unknown>>("leads"), all<Record<string, unknown>>("sync_queue")]);
    database.close();
    return { mappings, leadCount: leads.length, mappingQueueCount: queue.filter((item) => item.table_name === "mapping_requests").length };
  });
}

test("Mapping accepts canonical suggestions and arbitrary text with zero Lead side effect", async ({ page, context }) => {
  await page.route("https://e2e.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://e2e.supabase.co/auth/v1/user", (route) => route.fulfill({ json: { id: employeeId, aud: "authenticated", role: "authenticated", email: "support@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  await seedSupportEmployee(page);
  await page.goto("/mappings");
  await expect(page.getByRole("heading", { name: "Distributor-retailer mappings" })).toBeVisible();
  await context.setOffline(true);

  const primary = page.getByPlaceholder("Search or type distributor");
  await primary.fill("AHM02168");
  await page.getByRole("option").first().click();
  await page.getByPlaceholder("Search or type retailer").fill("ABC MEDICAL & GENERAL STORE #42");
  await page.getByPlaceholder("Search or type retailer").press("Escape");
  await page.getByRole("button", { name: "Create mapping request" }).click();
  await expect(page.getByText(/Successfully logged 1 mapping task/)).toBeVisible();

  const first = await mappingSnapshot(page);
  expect(first.leadCount).toBe(0);
  expect(first.mappingQueueCount).toBe(1);
  expect(first.mappings[0]).toMatchObject({
    distributor_lead_id: null,
    retailer_lead_id: null,
    retailer_name_unregistered: "ABC MEDICAL & GENERAL STORE #42",
    requested_by: employeeId,
    mapped_by: null,
  });
  await expect(page.getByText("Logged by: Support Employee")).toBeVisible();
  await expect(page.getByText("Completed by: —")).toBeVisible();

  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  await page.getByPlaceholder("Search or type retailer").fill("Retailer 100 & Sons");
  await page.getByPlaceholder("Search or type retailer").press("Escape");
  await page.getByPlaceholder("Search or type distributor").fill("Distributor (West) / 200");
  await page.getByPlaceholder("Search or type distributor").press("Escape");
  await page.getByRole("button", { name: "Create mapping request" }).click();
  const second = await mappingSnapshot(page);
  expect(second.leadCount).toBe(0);
  expect(second.mappings).toHaveLength(2);
  expect(second.mappings).toEqual(expect.arrayContaining([expect.objectContaining({ retailer_name_unregistered: "Retailer 100 & Sons", distributor_name_unregistered: "Distributor (West) / 200" })]));

  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText("ABC MEDICAL & GENERAL STORE #42")).toBeVisible();
  expect((await mappingSnapshot(page)).leadCount).toBe(0);
});
