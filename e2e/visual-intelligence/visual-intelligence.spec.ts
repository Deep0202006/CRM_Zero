import { expect, test, type Page } from "@playwright/test";
import { getCurrentISTDate } from "../../src/lib/dateTime";

const adminId = "91000000-0000-4000-a000-000000000001";
const employeeId = "92000000-0000-4000-a000-000000000001";
const today = getCurrentISTDate();

function token(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`;
}

async function seedAdmin(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible();
  await page.evaluate(async ({ adminId, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["users", "user_capabilities"], "readwrite");
    transaction.objectStore("users").put({ user_id: adminId, name: "Visual Admin", email: "admin@example.test", is_active: 1, created_at: new Date().toISOString() });
    transaction.objectStore("user_capabilities").put({ id: `${adminId}-admin`, user_id: adminId, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    localStorage.setItem("authenticated_user_id", adminId);
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { adminId, accessToken: token(adminId) });
}

async function mockPlatform(page: Page) {
  await page.route("https://e2e.supabase.co/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://e2e.supabase.co/auth/v1/user", route => route.fulfill({ json: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
}

async function expectResponsiveAnalytics(page: Page, heading: string, reviewName: string) {
  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    if (process.env.VISUAL_REVIEW && width === 375) await page.screenshot({ path: `artifacts/visual-review/${reviewName}-mobile.png`, fullPage: true });
  }
  expect(await page.locator("[data-chart-height='stable']").first().evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(220);
  await expect(page.locator("body")).not.toContainText(/NaN|Infinity/);
  if (process.env.VISUAL_REVIEW) await page.screenshot({ path: `artifacts/visual-review/${reviewName}-desktop.png`, fullPage: true });
}

test("My Day analytics reuses existing data paths and remains operational at every target width", async ({ page }) => {
  await mockPlatform(page);
  const businessRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/")) businessRequests.push(new URL(request.url()).pathname); });
  await page.route("**/api/my-day/daily-summary", route => route.fulfill({ json: { genuine_calls_today: 4, followup_calls_today: 1, confirmed_genuine_call_ids: [], confirmed_followup_call_ids: [], normal_tasks_completed_today: 2, followup_tasks_completed_today: 1, total_tasks_completed_today: 3, pending_followups: 0, unique_completed_work: 7, generated_at: new Date().toISOString() } }));
  await page.route("**/api/my-day/payment-followups", route => route.fulfill({ json: { reminders: [] } }));
  await page.route("**/api/my-day/receivables", route => route.fulfill({ json: { items: [], generated_at: new Date().toISOString() } }));
  await seedAdmin(page);
  await page.goto("/my-day");
  await expect(page.getByRole("heading", { name: "Today’s focus orbit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Urgency ribbon" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sync data/i })).toBeVisible();
  expect(new Set(businessRequests)).toEqual(new Set(["/api/my-day/daily-summary", "/api/my-day/payment-followups", "/api/my-day/receivables"]));
  await expectResponsiveAnalytics(page, "Today’s focus orbit", "my-day");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today’s focus orbit" })).toBeVisible();
  expect(parseFloat(await page.locator(".analytics-panel").first().evaluate(node => getComputedStyle(node).animationDuration))).toBeLessThanOrEqual(0.00001);
});

test("Team Intelligence preserves exact contribution totals with one initial KPI request and keyboard controls", async ({ page }) => {
  await mockPlatform(page);
  let requests = 0;
  await page.route("**/api/team-kpi", route => {
    requests += 1;
    return route.fulfill({ json: {
      target_date: today,
      generated_at: new Date().toISOString(),
      rows: [
        { user_id: adminId, name: "Visual Admin", role: "Admin", capabilities: ["admin"], calls_made: 8, followup_calls: 1, queries_handled: 4, mappings_completed: 2, tasks_completed: 3, total_completed_work: 17, latest_activity_time: new Date().toISOString(), attendance_status: "Present" },
        { user_id: employeeId, name: "Field Employee", role: "Field", capabilities: ["field_ret"], calls_made: 2, followup_calls: 0, queries_handled: 1, mappings_completed: 1, tasks_completed: 2, total_completed_work: 6, latest_activity_time: new Date().toISOString(), attendance_status: "Present" },
      ],
      totals: { team_members: 2, calls_made: 10, followup_calls: 1, queries_handled: 5, mappings_completed: 3, tasks_completed: 5, total_completed_work: 23 },
      source: "server-aggregation",
      warnings: [],
    } });
  });
  await seedAdmin(page);
  await page.goto("/manager/kpi");
  await expect(page.getByRole("heading", { name: "Confirmed work pulse" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contribution ring" })).toBeVisible();
  await expect(page.getByText("10 · 80%", { exact: true })).toHaveCount(0);
  await expect(page.getByText("8 · 80%", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Client queries" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("4 · 80%", { exact: true })).toBeVisible();
  expect(requests).toBe(1);
  await expectResponsiveAnalytics(page, "Confirmed work pulse", "team-kpi");
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.locator("[data-chart-height='stable']").first()).toBeVisible();
  if (process.env.VISUAL_REVIEW) await page.screenshot({ path: "artifacts/visual-review/team-kpi-dark.png", fullPage: true });
});

test("Visits visual composition reconciles the bounded page and closes with server filters", async ({ page }) => {
  await mockPlatform(page);
  const requestUrls: string[] = [];
  await page.route("**/api/admin/visits**", route => {
    const url = new URL(route.request().url());
    requestUrls.push(url.toString());
    const retailerOnly = url.searchParams.get("segment") === "Retailer";
    const visits = [
      { visit_id: "93000000-0000-4000-a000-000000000001", user_id: employeeId, lead_id: "94000000-0000-4000-a000-000000000001", visit_date: today, check_in_time: "2026-08-15T04:00:00Z", address: "Pune", visit_outcome: "installed", person_met: "Owner", segment_type: "Retailer", selfie_status: "PURGED", users: { name: "Field Employee" }, leads: { business_name: "Retail Shop" } },
      { visit_id: "93000000-0000-4000-a000-000000000002", user_id: employeeId, lead_id: "94000000-0000-4000-a000-000000000002", visit_date: today, check_in_time: "2026-08-15T06:00:00Z", address: "Mumbai", visit_outcome: "payment_done", person_met: "Owner", segment_type: "Distributor", selfie_status: "PURGED", users: { name: "Field Employee" }, leads: { business_name: "Distributor Shop" } },
    ].filter(visit => !retailerOnly || visit.segment_type === "Retailer");
    return route.fulfill({ json: { visits, page: 1, page_size: 50, total: visits.length, all_time_total: 2, today_total: 2, has_more: false, representatives: [{ user_id: employeeId, name: "Field Employee", email: "employee@example.test", is_active: true, capabilities: ["field_ret"], historical_only: false }] } });
  });
  await seedAdmin(page);
  await page.goto("/admin/visits");
  await expect(page.getByRole("heading", { name: "Outcome composition" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Loaded visits", { exact: true })).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  expect(requestUrls).toHaveLength(1);
  await page.getByRole("button", { name: "Retailer", exact: true }).click();
  await expect.poll(() => requestUrls.length).toBe(2);
  expect(new URL(requestUrls.at(-1)!).searchParams.get("segment")).toBe("Retailer");
  await expect(page.getByText("Current bounded page 1 · 1 of 1 matching visits", { exact: false }).first()).toBeVisible();
  await expectResponsiveAnalytics(page, "Outcome composition", "visits");
});
