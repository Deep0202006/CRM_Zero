import { expect, test, type Page } from "@playwright/test";

const owner = "10000000-0000-4000-a000-000000000001";
const other = "10000000-0000-4000-a000-000000000002";
const admin = "10000000-0000-4000-a000-000000000003";
const retailLead = "20000000-0000-4000-a000-000000000001";
const distributorLead = "20000000-0000-4000-a000-000000000002";
function token(id: string) { const e = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"); return `${e({ alg: "none" })}.${e({ sub: id, exp: 1999999999 })}.e2e`; }

async function seed(page: Page, id: string, role: "employee" | "admin") {
  await page.goto("/login"); await page.waitForTimeout(400);
  await page.evaluate(async ({ id, role, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = database.transaction(["users", "user_capabilities"], "readwrite");
    tx.objectStore("users").put({ user_id: id, name: role === "admin" ? "Admin User" : "Employee", email: `${role}@example.test`, is_active: 1, created_at: new Date().toISOString() });
    tx.objectStore("user_capabilities").put({ id: `${id}-cap`, user_id: id, capability_code: role === "admin" ? "admin" : "ret_onboarding", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
    localStorage.setItem("authenticated_user_id", id);
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: `${role}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id, role, accessToken: token(id) });
}

async function mock(page: Page, actor: string) {
  await page.route("https://e2e.supabase.co/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://e2e.supabase.co/auth/v1/user", route => route.fulfill({ json: { id: actor, aud: "authenticated", role: "authenticated", email: "user@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  await page.route("**/api/pipeline/leads**", route => {
    const segment = new URL(route.request().url()).searchParams.get("segment") ?? "Retailer";
    const leads = segment === "Retailer"
      ? [{ lead_id: retailLead, business_name: "Retail Shop", contact_person: "Riya", phone: "999", segment_type: "Retailer", status: "Installation", assigned_to: owner, owner_name: "Assigned Owner", created_at: "2026-08-12T00:00:00Z" }]
      : [{ lead_id: distributorLead, business_name: "Distributor Firm", contact_person: "Dev", phone: "888", segment_type: "Distributor", status: "Installation", assigned_to: owner, owner_name: "Assigned Owner", created_at: "2026-08-12T00:00:00Z" }];
    return route.fulfill({ json: { leads, operations: [], page: 1, pageSize: 50, total: 1, hasMore: false } });
  });
  await page.route("**/api/pipeline/transition", async route => {
    const command = route.request().postDataJSON();
    return route.fulfill({ json: { success: true, operation_id: command.operation_id, lead: { lead_id: command.lead_id, status: command.target_stage } } });
  });
}

test("global visibility keeps ordinary actions owner-only, including Admin", async ({ page }) => {
  await mock(page, admin); await seed(page, admin, "admin"); await page.goto("/onboarding");
  await expect(page.getByText("Retail Shop")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Converted" })).toHaveCount(0);
  await page.getByRole("button", { name: "Distributors" }).click();
  await expect(page.getByText("Distributor Firm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move to Payment" })).toHaveCount(0);
});

test("Retailer omits Payment, Distributor retains it, and owner can act", async ({ page }) => {
  await mock(page, owner); await seed(page, owner, "employee"); await page.goto("/onboarding");
  await expect(page.getByRole("article").filter({ hasText: /^Payment/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Move to Converted" })).toBeVisible();
  await page.getByRole("button", { name: "Distributors" }).click();
  await expect(page.getByRole("article").filter({ hasText: /^Payment/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Move to Payment" })).toBeVisible();
});

test("Pipeline remains bounded and usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await mock(page, other); await seed(page, other, "employee"); await page.goto("/onboarding");
  await expect(page.getByLabel(/Retailer pipeline board/)).toBeVisible();
  await expect(page.getByText("Page 1 · showing 1 of 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
});
