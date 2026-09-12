import { expect, test, type Page } from "@playwright/test";
import { aggregateVisitRange, parseVisitRange, type VisitEvent } from "../../src/lib/fieldVisits/range";
import { getCurrentISTDate } from "../../src/lib/dateTime";
import { mkdir, writeFile } from "node:fs/promises";

const adminId = "91000000-0000-4000-a000-000000000001";
const employeeId = "92000000-0000-4000-a000-000000000001";
const today = getCurrentISTDate();
const foundationPhase = process.env.UI_FOUNDATION_PHASE;
const chartWarnings = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const warnings: string[] = [];
  chartWarnings.set(page, warnings);
  page.on("console", message => {
    if (/width\(-?\d+\).*height\(-?\d+\)|width.*height.*greater than 0|ResponsiveContainer.*nested/i.test(message.text())) warnings.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  if (foundationPhase !== "before") expect(chartWarnings.get(page), "Chart sizing warnings").toEqual([]);
});

async function captureFoundation(page: Page, name: string, requests: () => unknown) {
  if (!foundationPhase) return;
  const directory = `artifacts/visual-review/ui-foundation-${foundationPhase}`;
  await mkdir(directory, { recursive: true });
  const observations: unknown[] = [];
  for (const theme of ["light", "dark"] as const) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    }
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => page.locator("span.tabular-nums[aria-label]").evaluateAll(nodes => nodes.every(node => node.textContent?.trim() === node.getAttribute("aria-label")))).toBe(true);
      if (foundationPhase === "after") {
        await expect.poll(() => page.getByRole("tab", { selected: true }).evaluate(node => getComputedStyle(node).color)).toBe(theme === "dark" ? "rgb(66, 184, 164)" : "rgb(9, 86, 79)");
        const contrasts = await page.locator(".ui-foundation .metric-card__label, .ui-foundation [data-state=active][role=tab], .ui-foundation .segmented-control button[aria-pressed=true], .ui-foundation .analytics-panel__header p").evaluateAll(nodes => nodes.map(node => {
          const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
          const luminance = (color: string) => channels(color).slice(0, 3).reduce((sum, value, index) => { const s = value / 255; return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]; }, 0);
          let ancestor: Element | null = node;
          while (ancestor && channels(getComputedStyle(ancestor).backgroundColor)[3] === 0) ancestor = ancestor.parentElement;
          const foreground = getComputedStyle(node).color;
          const background = getComputedStyle(ancestor ?? document.body).backgroundColor;
          const a = luminance(foreground), b = luminance(background);
          return { text: node.textContent, foreground, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        }));
        expect(contrasts.filter(sample => sample.ratio < 4.5), `${name} ${theme} essential small text`).toEqual([]);
        observations.push({ width, theme, contrasts });
      }
      await page.screenshot({ path: `${directory}/${name}-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
      if (foundationPhase === "after" && ((width === 390 && theme === "light") || (width === 1440 && theme === "dark"))) {
        await page.locator(".analytics-panel").first().evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.screenshot({ path: `${directory}/${name}-${width}-${theme}-charts.png`, animations: "disabled" });
        await page.getByRole("heading", { name: name === "team-kpi" ? "Team KPI register" : "Confirmed visit history", exact: true }).evaluate(node => node.scrollIntoView({ block: "start", behavior: "instant" }));
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.screenshot({ path: `${directory}/${name}-${width}-${theme}-register.png`, animations: "disabled" });
        await page.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
      }
      observations.push(await page.evaluate(({ width, theme }) => ({
        width, theme,
        plotDimensions: Array.from(document.querySelectorAll("svg.recharts-surface")).map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
        scripts: Array.from(document.scripts).map(script => script.src).filter(Boolean),
        resources: performance.getEntriesByType("resource").map(entry => { const resource = entry as PerformanceResourceTiming; return { name: resource.name, initiatorType: resource.initiatorType, transferSize: resource.transferSize, decodedBodySize: resource.decodedBodySize }; }),
      }), { width, theme }));
    }
  }
  await writeFile(`${directory}/${name}-observations.json`, JSON.stringify({ fixture: "visual-intelligence-unfiltered", requests: requests(), observations }, null, 2));
  await page.getByRole("button", { name: "Use light theme" }).click();
}

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
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { adminId, accessToken: token(adminId) });
}

async function mockPlatform(page: Page) {
  await page.route("http://127.0.0.1:54321/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("http://127.0.0.1:54321/auth/v1/user", route => route.fulfill({ json: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
}

async function mockRangeAnalysis(page: Page, events: (params: URLSearchParams) => VisitEvent[]) {
  await page.route("**/api/admin/visits/analysis?**", route => {
    const params = new URL(route.request().url()).searchParams, generated_at = new Date().toISOString();
    const scope = parseVisitRange(params, generated_at);
    return route.fulfill({ json: { kind: "visit-range-v1", scope, generated_at, retained_source_read: "exhausted", historical_coverage: "uncertified", consistency: "bounded-live-multi-request", ...aggregateVisitRange(scope, events(params)) } });
  });
}

async function expectResponsiveAnalytics(page: Page, heading: string, reviewName: string, chartExpected = true) {
  for (const width of [320, 375, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(dimensions.scroll, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    await expect.poll(() => page.locator("svg.recharts-surface").evaluateAll(nodes => nodes.filter(node => node.getClientRects().length > 0).every(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    }))).toBe(true);
    if (process.env.VISUAL_REVIEW && width === 375) await page.screenshot({ path: `artifacts/visual-review/${reviewName}-mobile.png`, fullPage: true });
  }
  if (chartExpected) expect(await page.locator("[data-chart-height='stable']").first().evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(220);
  await expect(page.locator("body")).not.toContainText(/NaN|Infinity/);
  if (process.env.VISUAL_REVIEW) await page.screenshot({ path: `artifacts/visual-review/${reviewName}-desktop.png`, fullPage: true });
}

test("My Day analytics reuses existing data paths and remains operational at every target width", async ({ page }) => {
  await mockPlatform(page);
  const businessRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/")) businessRequests.push(new URL(request.url()).pathname); });
  await page.route("**/api/my-day/daily-summary", route => route.fulfill({ json: { genuine_calls_today: 4, followup_calls_today: 1, confirmed_genuine_call_ids: [], confirmed_followup_call_ids: [], normal_tasks_completed_today: 2, followup_tasks_completed_today: 1, total_tasks_completed_today: 3, pending_followups: 0, unique_completed_work: 7, focus_signals: [{ id: "task-1", priority: "P0", reason_code: "FOLLOWUP_DUE_TODAY", reason: "Exact follow-up due today", kind: "task", title: "Call Acme", due_date: today }], generated_at: new Date().toISOString() } }));
  await page.route("**/api/my-day/payment-followups", route => route.fulfill({ json: { reminders: [] } }));
  await page.route("**/api/my-day/receivables", route => route.fulfill({ json: { items: [], generated_at: new Date().toISOString() } }));
  await seedAdmin(page);
  await page.goto("/my-day");
  await expect(page.getByRole("region", { name: "Work agenda" })).toBeVisible();
  await expect(page.getByText("Call Acme", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sync data/i })).toBeVisible();
  expect(new Set(businessRequests)).toEqual(new Set(["/api/my-day/daily-summary", "/api/my-day/payment-followups", "/api/my-day/receivables"]));
  await expectResponsiveAnalytics(page, "My Day", "my-day", false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("region", { name: "Work agenda" })).toBeVisible();
  expect(parseFloat(await page.locator(".workspace-register").first().evaluate(node => getComputedStyle(node).animationDuration))).toBeLessThanOrEqual(0.00001);
});

test("UI Foundation employee Sheet preserves identity through refresh without a detail request", async ({ page }) => {
  test.skip(foundationPhase === "before", "The baseline predates the employee Sheet");
  await mockPlatform(page);
  const longName = "Field Employee With A Long Name That Must Remain Fully Available";
  const row = (user_id: string, name: string, calls_made: number) => ({ user_id, name, role: "Field", capabilities: ["field_ret"], calls_made, followup_calls: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0, total_completed_work: calls_made, latest_activity_time: null, attendance_status: "Absent" });
  let rows = [row(adminId, "Visual Admin", 1), row(employeeId, longName, 0)];
  const pendingResponses: Array<() => void> = [];
  let delay = false;
  let fail = false;
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(new URL(request.url()).pathname); });
  await page.route("**/api/team-kpi", async route => {
    if (delay) await new Promise<void>(resolve => { pendingResponses.push(resolve); });
    if (fail) return route.fulfill({ status: 503, json: { message: "Synthetic refresh unavailable" } });
    return route.fulfill({ json: { target_date: today, generated_at: `${today}T06:00:00Z`, source: "server-aggregation", warnings: [], rows,
      totals: { team_members: rows.length, calls_made: rows.reduce((sum, item) => sum + item.calls_made, 0), followup_calls: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0, total_completed_work: rows.reduce((sum, item) => sum + item.calls_made, 0) } } });
  });
  await seedAdmin(page);
  await page.goto("/manager/kpi");
  await page.setViewportSize({ width: 390, height: 900 });
  const employee = page.getByRole("button", { name: longName, exact: true });
  await employee.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: longName, exact: true })).toBeVisible();
  await expect(dialog).toContainText("Absent");
  await expect(dialog).toContainText(today);
  await expect(dialog).toContainText("No work recorded");
  expect(requests).toEqual(["/api/team-kpi"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(employee).toBeFocused();

  // Hold the normal Refresh response, then inspect while the existing request is pending.
  delay = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect.poll(() => pendingResponses.length).toBe(1);
  await employee.click();
  rows = [...rows].reverse();
  pendingResponses.shift()!();
  await expect(dialog.getByText("Refreshing. The last confirmed report remains visible.", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: longName, exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  await page.keyboard.press("Escape");

  fail = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect.poll(() => pendingResponses.length).toBe(1);
  await employee.click();
  pendingResponses.shift()!();
  await expect(dialog).toContainText(/last confirmed|stale|refresh.*fail|unavailable/i);
  await expect(dialog.getByRole("heading", { name: longName, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  fail = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect.poll(() => pendingResponses.length).toBe(1);
  await employee.click();
  rows = rows.filter(item => item.user_id !== employeeId);
  pendingResponses.shift()!();
  await expect(dialog.getByRole("heading", { name: "Employee unavailable", exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("Visual Admin");
  expect(requests).toEqual(Array(4).fill("/api/team-kpi"));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("UI Foundation ERP manual activation caches success and retries a network failure exactly once", async ({ page }) => {
  test.skip(foundationPhase === "before", "The baseline predates accessible manual Tabs");
  await mockPlatform(page);
  let visitRequests = 0;
  let erpRequests = 0;
  const pendingResponses: Array<() => void> = [];
  await page.route(url => url.pathname === "/api/admin/visits", route => {
    visitRequests += 1;
    return route.fulfill({ json: { visits: [], page: 1, page_size: 50, total: 0, all_time_total: 0, today_total: 0, has_more: false, representatives: [] } });
  });
  await page.route("**/api/admin/visits/erp-analytics", async route => {
    erpRequests += 1;
    if (erpRequests === 1) return route.abort("failed");
    await new Promise<void>(resolve => { pendingResponses.push(resolve); });
    return route.fulfill({ json: { segments: { Retailer: { unique_businesses: 6, observed_count: 5, erp_using_count: 5, none_count: 0, not_captured_count: 1, coverage_percent: 100 * 5 / 6, categories: ["Long Accounting ERP Name", "ERP B", "ERP C", "ERP D", "ERP E", "Not captured"].map((erp_name, index) => ({ erp_name, state: index === 5 ? "not_captured" : "erp", count: 1, share_percent: 100 / 6 })) }, Distributor: { unique_businesses: 7, observed_count: 6, erp_using_count: 6, none_count: 0, not_captured_count: 1, coverage_percent: 100 * 6 / 7, categories: ["ERP A", "ERP B", "ERP C", "ERP D", "ERP E", "ERP F", "Not captured"].map((erp_name, index) => ({ erp_name, state: index === 6 ? "not_captured" : "erp", count: 1, share_percent: 100 / 7 })) } } } });
  });
  await seedAdmin(page);
  await page.goto("/admin/visits");
  const activity = page.getByRole("tab", { name: "Visit Activity" });
  const erp = page.getByRole("tab", { name: "ERP Intelligence" });
  await activity.focus();
  await page.keyboard.press("End");
  await expect(erp).toBeFocused();
  await expect(activity).toHaveAttribute("aria-selected", "true");
  expect(erpRequests).toBe(0);
  await page.keyboard.press("Home");
  await expect(activity).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(erp).toBeFocused();
  expect(erpRequests).toBe(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "ERP intelligence" })).toContainText(/unavailable|failed/i);
  expect(erpRequests).toBe(1);
  await activity.click();
  await erp.click();
  await expect(page.getByRole("alert").filter({ hasText: "ERP intelligence" })).toBeVisible();
  expect(erpRequests).toBe(1);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => pendingResponses.length).toBe(1);
  await activity.click();
  await erp.click();
  expect(erpRequests).toBe(2);
  pendingResponses.shift()!();
  await expect(page.getByRole("heading", { name: "Retailer ERP Footprint" })).toBeVisible();
  await activity.click();
  await erp.click();
  await expect(page.getByRole("heading", { name: "Retailer ERP Footprint" })).toBeVisible();
  expect(erpRequests).toBe(2);
  expect(visitRequests).toBe(1);
  const retailerFootprint = page.getByRole("region", { name: "Retailer ERP Footprint", exact: true });
  const distributorFootprint = page.getByRole("region", { name: "Distributor ERP Footprint", exact: true });
  await expect(retailerFootprint.locator(".recharts-pie")).toBeVisible();
  await expect(retailerFootprint.getByRole("listitem")).toHaveCount(6);
  await expect(distributorFootprint.locator(".recharts-bar")).toBeVisible();
  await expect(distributorFootprint.getByRole("listitem")).toHaveCount(7);
  await expect(distributorFootprint.getByRole("list")).toContainText("Not captured (unknown):1");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  const resolved = await page.locator(".analytics-panel").first().evaluate(node => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
  expect(resolved.foreground).not.toBe(resolved.background);
  expect(resolved.foreground).toMatch(/^rgb/);
  const pie = page.locator(".recharts-pie").first();
  await pie.scrollIntoViewIfNeeded();
  const pieBounds = await pie.boundingBox();
  await page.mouse.move(pieBounds!.x + pieBounds!.width * 0.85, pieBounds!.y + pieBounds!.height * 0.3);
  const tooltip = page.locator(".recharts-tooltip-wrapper:visible").first();
  await expect(tooltip).toContainText("Long Accounting ERP Name");
  const colors = await tooltip.locator(":scope > *").first().evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
  expect(colors.color).not.toBe(colors.background);
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("Visits full-range strip retains fourteen records while the register pages seven records", async ({ page }) => {
  test.skip(foundationPhase === "before", "The baseline does not expose the shared semantic values list");
  await mockPlatform(page);
  const requestPages: string[] = [], analysisRequests: string[] = [];
  const fullOutcomes = ["registered", "installed", "installed", "interested", "follow_up", "payment_follow_up", "legacy_unknown", "registered", "installed", "interested", "follow_up", "payment_follow_up", "payment_done", "legacy_unknown"];
  await mockRangeAnalysis(page, params => {
    analysisRequests.push(params.toString());
    return fullOutcomes.map((visit_outcome, index) => ({ visit_id: `93000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`, user_id: employeeId, visit_date: today, check_in_time: `${today}T04:00:00Z`, visit_outcome, segment_type: "Retailer" }));
  });
  await page.route(url => url.pathname === "/api/admin/visits", route => {
    const currentPage = Number(new URL(route.request().url()).searchParams.get("page"));
    requestPages.push(String(currentPage));
    const outcomes = currentPage === 1
      ? ["registered", "installed", "installed", "interested", "follow_up", "payment_follow_up", "legacy_unknown"]
      : ["registered", "installed", "interested", "follow_up", "payment_follow_up", "payment_done", "legacy_unknown"];
    const visits = outcomes.map((visit_outcome, index) => ({ visit_id: `93000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`, user_id: employeeId, lead_id: `94000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`, visit_date: today, check_in_time: `${today}T04:00:00Z`, address: "Synthetic Pune fixture", visit_outcome, person_met: "Owner", segment_type: index === 6 ? "Historical" : "Retailer", selfie_status: "PURGED", users: { name: "Field Employee" }, leads: { business_name: `Fixture business ${index + 1}` } }));
    return route.fulfill({ json: { visits, page: currentPage, page_size: 50, total: 14, all_time_total: 14, today_total: 14, has_more: currentPage === 1, representatives: [] } });
  });
  await seedAdmin(page);
  await page.goto("/admin/visits");
  const composition = page.getByRole("region", { name: "Outcome composition", exact: true });
  await expect(composition).toContainText("Full applied range");
  const values = composition.getByRole("list");
  await expect(values).toHaveCount(1);
  await expect(values).toContainText("Unknown / legacy outcome");
  await expect(values).toContainText("Installed");
  await expect(page.getByText(/Applied:.*7 of 14 matching visits/)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(composition).toContainText("Full applied range");
  await expect(values).toHaveCount(1);
  await expect(values).toContainText("Unknown / legacy outcome");
  await expect(values).toContainText("Payment done");
  const counts = await values.getByRole("listitem").allTextContents();
  const valuesOnly = counts.map(text => Number(text.match(/·\s*([\d,]+)/)?.[1]?.replaceAll(",", "")));
  expect([...valuesOnly].sort((a, b) => a - b)).toEqual([1, 2, 2, 2, 2, 2, 3]);
  expect(valuesOnly.reduce((sum, value) => sum + value, 0)).toBe(14);
  expect(analysisRequests).toHaveLength(1);
  expect(requestPages).toEqual(["1", "2"]);
});

test("Team Intelligence preserves exact contribution totals with one initial KPI request and keyboard controls", async ({ page }) => {
  await mockPlatform(page);
  let requests = 0;
  let partial = false;
  await page.route("**/api/team-kpi", route => {
    requests += 1;
    return route.fulfill({ json: {
      target_date: today,
      generated_at: `${today}T06:00:00Z`,
      rows: [
        { user_id: adminId, name: "Visual Admin", role: "Admin", capabilities: ["admin"], calls_made: 8, followup_calls: 1, queries_handled: 4, mappings_completed: 2, tasks_completed: 3, total_completed_work: 17, latest_activity_time: `${today}T05:00:00Z`, attendance_status: "Present" },
        { user_id: employeeId, name: "Field Employee", role: "Field", capabilities: ["field_ret"], calls_made: 2, followup_calls: 0, queries_handled: 1, mappings_completed: 1, tasks_completed: 2, total_completed_work: 6, latest_activity_time: `${today}T04:00:00Z`, attendance_status: "Present" },
      ],
      totals: { team_members: 2, calls_made: 10, followup_calls: 1, queries_handled: 5, mappings_completed: 3, tasks_completed: 5, total_completed_work: 23 },
      source: "server-aggregation",
      warnings: partial ? [{ source: "tasks", message: "Synthetic task-source coverage warning" }] : [],
    } });
  });
  const inspectionRequests: string[] = [];
  await page.route("**/api/pipeline/inspection**", route => {
    inspectionRequests.push(route.request().url());
    const history = Array.from({ length: 12 }, (_, index) => ({ period: `P${index + 1}`, new_leads: index === 11 ? 2 : 0, successes: index === 11 ? 1 : 0, movements: index === 11 ? 2 : 0, advanced: index === 11 ? 1 : 0, regressed: 0 }));
    return route.fulfill({ json: { scope: { page_size: 50, matched_total: 1, generated_at: new Date().toISOString() }, stages: [{ stage: "New", count: 1 }], sources: [{ source: "Referral", total: 1, converted: 0, rate: 0, reconciled: true }], current_stage_age: [{ stage: "New", average_days: 2 }], historical_velocity: { rows: [{ stage: "New", p50_days: 2, average_days: 2, sample_n: 1 }], sample_n: 1, coverage_n: 1, coverage_pct: 100 }, history: { weeks: history, months: history, lead_sample_n: 1, transition_sample_n: 1, coverage: "Bounded exact sample.", lead_sample_limited: false, transition_sample_limited: false }, owner_options: [{ user_id: employeeId, name: "Field Employee" }], leads: [{ lead_id: "94000000-0000-4000-a000-000000000001", business_name: "Acme", segment_type: "Retailer", status: "New", owner_name: "Field Employee", stage_age_days: 2, attention_reasons: [], next_task: null, recent_call: null }] } });
  });
  await seedAdmin(page);
  await page.goto("/manager/kpi");
  if (foundationPhase === "before") await expect(page.getByRole("heading", { name: "Work by type" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team KPI register", exact: true })).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  expect(inspectionRequests).toHaveLength(0);
  await captureFoundation(page, "team-kpi", () => ({ teamKpi: requests, pipeline: inspectionRequests.length }));
  if (foundationPhase === "before") return;
  for (const [label, value] of [["Calls today", "10"], ["Tasks completed", "5"], ["Mappings completed", "3"], ["Queries resolved", "5"]]) {
    await expect(page.locator(".workspace-counts > div").filter({ hasText: label }).locator("dd")).toHaveText(value);
  }
  const register = page.getByRole("region", { name: "Team KPI register", exact: true }).last();
  await expect(register.locator("tbody tr").first()).toContainText("Field Employee");
  await page.getByLabel("Sort by").selectOption("calls_made");
  await expect(register.locator("tbody tr").first()).toContainText("Visual Admin");
  await page.getByRole("button", { name: "Show employee reference" }).click();
  await expect(page.getByRole("region", { name: "Employee vs team average" })).toContainText("including the selected employee");
  await expectResponsiveAnalytics(page, "Employee vs team average", "team-kpi");
  partial = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Employee vs team average" })).toContainText("Comparison unavailable");
  await expect(page.getByText(/Some KPI sources need attention/)).toContainText("Synthetic task-source coverage warning");
  expect(requests).toBe(2);
  await page.getByRole("tab", { name: /Pipeline inspection/ }).click();
  await expect(page.getByRole("region", { name: "Current stage occupancy" })).toBeVisible();
  await page.getByText("Register filters", { exact: true }).click();
  await page.getByLabel("Recent change").check();
  await expect.poll(() => inspectionRequests.length).toBe(2);
  expect(new URL(inspectionRequests.at(-1)!).searchParams.get("recentChange")).toBe("true");
  await page.getByRole("combobox", { name: "Event", exact: true }).selectOption("regressed");
  await expect(page.getByRole("heading", { name: "Pipeline event history" })).toBeVisible();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
  if (process.env.VISUAL_REVIEW) await page.screenshot({ path: "artifacts/visual-review/team-kpi-dark.png", fullPage: true });
});

test("Visits visual composition reconciles the bounded page and closes with server filters", async ({ page }) => {
  await mockPlatform(page);
  const requestUrls: string[] = [];
  await mockRangeAnalysis(page, params => ["Retailer", "Distributor"].filter(segment => !params.has("segment") || params.get("segment") === segment).map((segment_type, index) => ({
    visit_id: `93000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`, user_id: employeeId, visit_date: today, check_in_time: `${today}T04:00:00Z`, visit_outcome: segment_type === "Retailer" ? "installed" : "payment_done", segment_type,
  })));
  await page.route(url => url.pathname === "/api/admin/visits", route => {
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
  await expect(page.getByRole("region", { name: "Full-range Visit activity" })).toContainText("2 retained Visit records", { timeout: 15_000 });
  expect(requestUrls).toHaveLength(1);
  await captureFoundation(page, "visits", () => requestUrls);
  if (foundationPhase === "before") return;
  await page.getByText("Refine representative, outcome and dates", { exact: true }).click();
  await page.getByText("Date and segment filters", { exact: true }).click();
  await page.getByLabel("Segment", { exact: true }).selectOption("Retailer");
  expect(requestUrls).toHaveLength(1);
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect.poll(() => requestUrls.length).toBe(2);
  expect(new URL(requestUrls.at(-1)!).searchParams.get("segment")).toBe("Retailer");
  await expect(page.getByRole("region", { name: "Full-range Visit activity" })).toContainText("1 retained Visit records");
  await expectResponsiveAnalytics(page, "Visit register", "visits", false);
});
