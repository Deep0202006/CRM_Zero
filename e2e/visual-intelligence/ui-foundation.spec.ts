import { expect, test, type Locator, type Page } from "@playwright/test";
import { getCurrentISTDate } from "../../src/lib/dateTime";

const adminId = "91000000-0000-4000-a000-000000000001";
const employeeId = "92000000-0000-4000-a000-000000000001";
const today = getCurrentISTDate();

test.beforeEach(async ({ page }) => {
  test.skip(process.env.UI_FOUNDATION_PHASE === "before", "Focused acceptance runs after the migration");
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
    transaction.objectStore("users").put({ user_id: adminId, name: "Visual Admin", email: "admin@example.test", is_active: 1, created_at: new Date().toISOString() });
    transaction.objectStore("user_capabilities").put({ id: `${adminId}-admin`, user_id: adminId, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", adminId);
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id: adminId, aud: "authenticated", role: "authenticated", email: "admin@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { adminId, accessToken });
});

function panel(page: Page, title: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).last();
}

async function hoverCategory(page: Page, chart: Locator, label: string) {
  await chart.scrollIntoViewIfNeeded();
  const tick = chart.locator("svg.recharts-surface").getByText(label, { exact: true }).first();
  await expect(tick).toBeVisible();
  const tickBounds = await tick.boundingBox();
  const plotBounds = await chart.locator("svg.recharts-surface").boundingBox();
  expect(tickBounds).not.toBeNull();
  expect(plotBounds).not.toBeNull();
  await page.mouse.move(plotBounds!.x + plotBounds!.width * 0.7, tickBounds!.y + tickBounds!.height / 2);
  const tooltip = chart.locator(".recharts-tooltip-wrapper:visible");
  await expect(tooltip).toBeVisible();
  return tooltip;
}

async function positivePlots(page: Page) {
  const plots = page.locator("svg.recharts-surface:visible");
  expect(await plots.count()).toBeGreaterThan(0);
  expect(await plots.evaluateAll(nodes => nodes.every(node => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }))).toBe(true);
}

async function contrast(page: Page) {
  return page.locator(".analytics-panel p, .surface-panel > p, .surface-panel h2").evaluateAll(nodes => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (channels: number[]) => channels.slice(0, 3).map(channel => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return nodes.filter(node => node.getClientRects().length && node.textContent?.trim()).map(node => {
      const style = getComputedStyle(node);
      let ancestor: Element | null = node;
      let background = "rgb(255, 255, 255)";
      while (ancestor) {
        const color = getComputedStyle(ancestor).backgroundColor;
        const channels = rgb(color);
        if (channels.length === 3 || channels[3] === 1) { background = color; break; }
        ancestor = ancestor.parentElement;
      }
      const foregroundLuminance = luminance(rgb(style.color));
      const backgroundLuminance = luminance(rgb(background));
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      return { text: node.textContent?.trim(), foreground: style.color, background, ratio, required: large ? 3 : 4.5 };
    });
  });
}

test("Payment consumer tooltips retain INR precision, zero, labels and both responsive charts", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(new URL(request.url()).pathname); });
  await page.route("**/api/receivables/health", route => route.fulfill({ json: { ready: true } }));
  await page.route(url => url.pathname === "/api/receivables", route => route.fulfill({ json: { rows: [], page: 1, pageSize: 20, total: 0 } }));
  await page.route("**/api/erp-systems", route => route.fulfill({ json: { rows: [] } }));
  await page.route("**/api/receivables/admin", route => route.fulfill({ json: { metrics: { total_outstanding: "123456.78", followups_due_today: 0, overdue_outstanding: "123456.78", collected_this_month: "0.00", total_collected: "0.00", collection_setup_required: 0, awaiting_verification: 0, disputed_outstanding: "0.00", aging: { Current: "123456.78", "1-7 days": "0.00", "8-15 days": "0.00", "16-30 days": "0.00", "31+ days": "0.00" } }, assignees: [], pending: [] } }));
  await page.route("**/api/distributors/renewals", route => route.fulfill({ json: { total: 1, rows: [{ distributor_id: "95000000-0000-4000-a000-000000000001", distributor_name: "Fixture Distributor", renewal_date: today, renewal_state: "due_today" }] } }));
  await page.goto("/admin/payments");
  const aging = panel(page, "Collectible aging");
  await expect(aging).toBeVisible();
  const tooltip = await hoverCategory(page, aging, "Current");
  await expect(tooltip).toContainText("Outstanding");
  await expect(tooltip).toContainText("₹1,23,456.78");
  await hoverCategory(page, aging, "1-7 days");
  await expect(tooltip).toContainText("₹0");
  await expect(tooltip).not.toContainText("Unavailable");
  await expect(panel(page, "Renewals Due Soon").locator("svg.recharts-surface")).toBeVisible();
  const requestsBeforePresentation = [...requests];
  const measurements: unknown[] = [];
  for (const theme of ["light", "dark"] as const) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 900 }); await positivePlots(page); }
    const samples = await contrast(page);
    expect(samples.length).toBeGreaterThan(0);
    measurements.push({ theme, samples });
    expect(samples.filter(sample => sample.ratio < sample.required), `${theme} essential text contrast`).toEqual([]);
    await hoverCategory(page, aging, "Current");
    await expect(tooltip).toContainText("₹1,23,456.78");
    const resolved = await tooltip.locator(":scope > *").first().evaluate(node => ({ background: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color }));
    expect(resolved.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(resolved.color).not.toBe(resolved.background);
    measurements.push({ theme, tooltip: resolved });
  }
  expect(requests).toEqual(requestsBeforePresentation);
  await testInfo.attach("payment-theme-contrast-and-requests", { body: JSON.stringify({ measurements, requests }, null, 2), contentType: "application/json" });
});

test("Attendance consumer switches daily bars to weekly lines without chart requests", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/admin/attendance?**", route => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    return route.fulfill({ json: { date_from: url.searchParams.get("date_from"), date_to: url.searchParams.get("date_to"), users: [{ user_id: employeeId, name: "Fixture Employee", capabilities: ["field_ret"] }], attendance: [{ attendance_id: "96000000-0000-4000-a000-000000000001", user_id: employeeId, date: today, clock_in: `${today}T04:00:00Z`, clock_out: null, selfie_purge_state: "purged" }] } });
  });
  await page.goto("/admin/attendance");
  const daily = page.getByRole("region", { name: "Present / absent composition" });
  await expect(daily.locator(".recharts-bar").first()).toBeVisible();
  const tooltip = await hoverCategory(page, daily, "Attendance");
  await expect(tooltip).toContainText("Present");
  await expect(tooltip).toContainText("Absent");
  await expect(tooltip).toContainText("0");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "weekly", exact: true }).click();
  const weekly = page.getByRole("region", { name: "Present count by date" });
  await expect(weekly.locator(".recharts-line")).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  for (const width of [1440, 390, 768]) { await page.setViewportSize({ width, height: 900 }); await positivePlots(page); }
  expect(requests).toHaveLength(2);
});

test("Funnel consumer preserves fractional days, percentages and grouped counts after lazy reveal", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/team-kpi", route => route.fulfill({ json: { target_date: today, generated_at: `${today}T06:00:00Z`, rows: [], totals: { team_members: 0, calls_made: 0, followup_calls: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0, total_completed_work: 0 }, source: "server-aggregation", warnings: [] } }));
  await page.route("**/api/pipeline/inspection?**", route => {
    requests += 1;
    const history = [{ period: "P1", new_leads: 1, successes: 0, movements: 0, advanced: 0, regressed: 0 }];
    return route.fulfill({ json: { scope: { page_size: 50, matched_total: 1, generated_at: `${today}T06:00:00Z` }, stages: [{ stage: "New", count: 123456 }], sources: [{ source: "Referral", total: 246912, converted: 123456, rate: 50, reconciled: true }], current_stage_age: [{ stage: "New", average_days: 2.5 }], historical_velocity: { rows: [{ stage: "New", p50_days: 1.25, average_days: 2.5, sample_n: 2 }], sample_n: 2, coverage_n: 2, coverage_pct: 100 }, history: { weeks: history, months: history, lead_sample_n: 1, transition_sample_n: 0, coverage: "Synthetic fixture; no complete period claim.", lead_sample_limited: false, transition_sample_limited: false }, owner_options: [], leads: [] } });
  });
  await page.goto("/manager/kpi");
  const funnel = page.getByRole("tab", { name: "Pipeline inspection", exact: true });
  await expect(funnel).toBeVisible();
  expect(requests).toBe(0);
  await funnel.click();
  const velocity = page.getByRole("region", { name: "Completed interval duration", exact: true });
  await expect(velocity).toContainText("1.25");
  await expect(velocity).toContainText("2.5");
  await page.getByText("Current stage age · not duration", { exact: true }).click();
  await expect(page.getByText("2.5 mean days", { exact: true })).toBeVisible();
  const source = page.getByRole("region", { name: "Source conversion data", exact: true });
  await expect(source).toContainText("50%");
  await expect(source).toContainText("1,23,456");
  await expect(source).toContainText("2,46,912");
  await expect(page.getByRole("region", { name: "Current stage occupancy" })).toContainText("1,23,456");
  await page.getByRole("combobox", { name: "Event", exact: true }).selectOption("regressed");
  await positivePlots(page);
  expect(requests).toBe(1);
});
