import { expect, test } from "@playwright/test";
import { addISTDateDays, getCurrentISTDate } from "../../src/lib/dateTime";
import { buildHistoryReport, parseHistoryScope } from "../../src/lib/teamKpi/history";
import { buildTeamKpiReport } from "../../src/lib/teamKpi/aggregate";
import { mkdir, writeFile } from "node:fs/promises";

const adminId = "91000000-0000-4000-a000-000000000001", employeeId = "92000000-0000-4000-a000-000000000001";
const today = getCurrentISTDate();
const capture = process.env.TEAM_HISTORY_CAPTURE === "true";
const members = [{ user_id: adminId, name: "Fixture Admin", role: "Administrator" }, { user_id: employeeId, name: "Fixture Employee with a long readable name", role: "Retail Support" }];
test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:54321/**", route => route.fulfill({ json: [] }));
  await page.route("http://127.0.0.1:54321/auth/v1/user", route => route.fulfill({ json: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: `${today}T04:00:00Z` } }));
  await page.goto("/login");
  await expect(page.getByText("Sign in to your account")).toBeVisible();
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encode({ alg: "none" })}.${encode({ sub: adminId, exp: 1999999999 })}.e2e`;
  await page.evaluate(async ({ adminId, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction(["users", "user_capabilities"], "readwrite");
    transaction.objectStore("users").put({ user_id: adminId, name: "Fixture Admin", email: "admin@example.test", is_active: 1, created_at: new Date().toISOString() });
    transaction.objectStore("user_capabilities").put({ id: `${adminId}-admin`, user_id: adminId, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", adminId);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { adminId, accessToken });
});

test("History reconciles scope, gaps, exact values, Sheet, keyboard and themes without presentation requests", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const requests: string[] = [], warnings: string[] = [];
  page.on("console", message => { if (/width.*height.*greater than 0|ResponsiveContainer.*nested/i.test(message.text())) warnings.push(message.text()); });
  let fail = false;
  await page.route("**/api/team-kpi**", async route => {
    const url = new URL(route.request().url()); requests.push(url.search);
    if (!url.search) return route.fulfill({ json: buildTeamKpiReport({ targetDate: today, users: members.map(row => ({ ...row, is_active: true })), userCapabilities: [{ user_id: adminId, capability_code: "admin" }], capabilities: [{ code: "admin", label: "Administrator" }], calls: [], clientQueries: [], mappings: [], tasks: [], taskHistory: [], allocatedTargets: [] }) });
    if (fail) return route.fulfill({ status: 503, json: { message: "Fixture source unavailable" } });
    const generatedAt = new Date().toISOString(), scope = parseHistoryScope(url.searchParams, generatedAt)!;
    const calls = Array.from({ length: 1234 }, (_, index) => ({ log_id: `fixture-${index}`, user_id: employeeId, timestamp: `${scope.from}T04:00:00Z`, outcome: "Contacted" }));
    calls.push({ log_id: "admin", user_id: adminId, timestamp: `${scope.to}T04:00:00Z`, outcome: "Contacted" });
    return route.fulfill({ json: buildHistoryReport({ scope, generatedAt, members, calls, requests: 5 }) });
  });
  await page.goto("/manager/kpi");
  await expect(page.getByRole("heading", { name: "Team KPI register", exact: true })).toBeVisible();
  const directory = "artifacts/visual-review/team-history-v1";
  if (capture) await mkdir(directory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (capture) await page.screenshot({ path: `${directory}/today-entry-1440.png`, fullPage: true, animations: "disabled" });
  const historyTab = page.getByRole("tab", { name: "Employee history", exact: true });
  await historyTab.focus(); await page.keyboard.press("Enter");
  const register = page.locator('[role="region"][aria-label="Employee history register"]');
  await expect(register).toBeVisible();
  await expect(register).toContainText("1,234");
  const daily = page.getByRole("region", { name: "History daily data", exact: true });
  await expect(daily).toContainText("Gap / unavailable");
  await expect(page.getByRole("heading", { name: /Whole current roster ·/ })).toBeVisible();
  const countBeforePresentation = requests.length;
  await page.getByLabel("Selected metric").selectOption("tasks_completed");
  await expect(page.getByText("Chart unavailable.", { exact: false })).toBeVisible();
  await expect(register).not.toContainText("1,234");
  await page.getByLabel("Selected metric").selectOption("calls_made");
  const chart = page.locator("svg.recharts-surface:visible");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-area-dots")).toBeVisible();
  await chart.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.locator(".recharts-tooltip-wrapper:visible")).toContainText("Unavailable");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".recharts-tooltip-wrapper:visible")).toContainText("Observed retained calls");
  await expect(page.locator(".recharts-tooltip-wrapper:visible")).toContainText("1,234");
  for (const theme of ["light", "dark"] as const) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await chart.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })).toBe(true);
      expect(await chart.locator(".recharts-cartesian-axis-tick-value").first().evaluate(node => getComputedStyle(node).fill)).toBe(await page.locator("#history-chart-title + p").evaluate(node => getComputedStyle(node).color));
      await page.getByRole("heading", { name: "Team Intelligence", exact: true }).scrollIntoViewIfNeeded();
      if (capture) {
        await page.screenshot({ path: `${directory}/history-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
        await page.getByRole("heading", { name: "Observed retained calls by IST date", exact: true }).evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
        await page.screenshot({ path: `${directory}/chart-${width}-${theme}.png`, animations: "disabled" });
        await page.getByRole("heading", { name: "Employee history register", exact: true }).evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
        await page.screenshot({ path: `${directory}/register-${width}-${theme}.png`, animations: "disabled" });
      }
      const employee = register.getByRole("button", { name: members[1].name, exact: true });
      await employee.focus(); await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog");
      await expect(sheet).toContainText("1,234");
      await expect(sheet).toContainText("Own period change");
      await expect(sheet).toContainText("Periods are not certified comparable");
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate(node => node.contains(document.activeElement))).toBe(true);
      if (capture) await page.screenshot({ path: `${directory}/detail-${width}-${theme}.png`, animations: "disabled" });
      await page.keyboard.press("Escape");
      await expect(employee).toBeFocused();
    }
  }
  expect(requests.length).toBe(countBeforePresentation);
  expect(warnings).toEqual([]);
  await page.getByLabel("Employee scope").selectOption(employeeId);
  await expect(page.getByText("Filters changed.", { exact: false })).toBeVisible();
  expect(requests.length).toBe(countBeforePresentation);
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`${members[1].name} ·`) })).toBeVisible();
  await expect(register.getByRole("button")).toHaveCount(2);
  expect(requests.length).toBe(countBeforePresentation + 1);
  fail = true;
  await page.getByLabel("From (IST)").fill(addISTDateDays(today, -6));
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture source unavailable" })).toContainText("Previous applied report remains visible");
  await expect(page.getByRole("heading", { name: new RegExp(`${members[1].name} · ${addISTDateDays(today, -7)}`) })).toBeVisible();
  await page.route("**/api/pipeline/inspection?**", route => route.fulfill({ status: 503, json: { message: "Outside the History fixture" } }));
  await page.getByRole("tab", { name: /Pipeline funnel/ }).click();
  await expect(page.getByText("Retained employee observations · Asia/Kolkata. Historical coverage is uncertified.", { exact: true })).not.toBeVisible();
  await testInfo.attach("history-observations", { body: JSON.stringify({ requests, warnings, fixture: "1235 bounded synthetic retained records; no production data" }, null, 2), contentType: "application/json" });
  if (capture) await writeFile(`${directory}/observations.json`, JSON.stringify({ fixture: "1235 bounded synthetic retained records; no production data", requests, warnings, themes: ["light", "dark"], widths: [1440, 390], checks: ["exact retained counts and unavailable gaps", "keyboard tooltip", "Sheet focus trap and return", "presentation causes no request", "employee selection retains reference cohort", "failed Apply retains prior applied scope"] }, null, 2));
});
