import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { addISTDateDays } from "../../src/lib/dateTime";
import { buildHistoryReport, parseHistoryScope } from "../../src/lib/teamKpi/history";
import { setup, actor, employee, today, report as todayReport } from "../workspace-makeover/fixtures";

const members = [{ user_id: actor, name: "Asha Mehta", role: "Administrator" }, { user_id: employee, name: "Nikhil Rao — Field Operations and Regional Customer Support", role: "Field" }];
const directory = "artifacts/visual-review/workspace-makeover/pr114-history";
const capture = process.env.TEAM_HISTORY_CAPTURE === "true";

test("typed history reconciles 31 dates, personal change, metric, Sheet, keyboard, themes and failed scope", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const requests = await setup(page), warnings: string[] = [];
  page.on("console", message => { if (/width.*height.*greater than 0|ResponsiveContainer.*nested/i.test(message.text())) warnings.push(message.text()); });
  let fail = false, stall = false, unavailable = false;
  await page.route("**/api/team-kpi**", async route => {
    const url = new URL(route.request().url());
    if (!url.search) return route.fulfill({ json: todayReport });
    if (stall) return;
    if (fail) return route.fulfill({ status: 503, json: { message: "Fixture source unavailable" } });
    const generatedAt = new Date().toISOString(), scope = parseHistoryScope(url.searchParams, generatedAt)!;
    const calls = Array.from({ length: 1234 }, (_, n) => ({ log_id: `current-${n}`, user_id: employee, timestamp: `${addISTDateDays(scope.from, n % scope.days)}T04:00:00Z`, outcome: "Contacted" }));
    calls.push(...Array.from({ length: 617 }, (_, n) => ({ log_id: `previous-${n}`, user_id: employee, timestamp: `${addISTDateDays(scope.previous_from, n % scope.days)}T04:00:00Z`, outcome: "Contacted" })));
    const events = scope.metric === "calls_made" ? undefined : Array.from({ length: scope.days * 3 }, (_, n) => ({ id: `event-${n}`, user_id: employee, date: addISTDateDays(scope.from, n % scope.days), timestamp: `${addISTDateDays(scope.from, n % scope.days)}T04:00:00Z` }));
    return route.fulfill({ json: buildHistoryReport({ scope, generatedAt, members, calls, events, requests: 5, sourceError: unavailable ? "Synthetic capped source; no partial totals." : null }) });
  });
  await page.goto("/manager/kpi");
  await expect(page.getByRole("heading", { name: "Team KPI register", exact: true })).toBeVisible();
  expect(requests.filter(value => value.startsWith("/api/team-kpi?"))).toHaveLength(0);
  await page.getByRole("tab", { name: "Employee history", exact: true }).focus(); await page.keyboard.press("Enter");
  const register = page.getByRole("region", { name: "Employee history register", exact: true });
  await expect(register).toContainText("1,234");
  await page.getByLabel("From (IST)").fill(addISTDateDays(today, -31));
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Whole current roster · ${addISTDateDays(today, -31)}`) })).toBeVisible();
  const dailyToggle = page.getByText("Exact daily data · chart and previous retained records", { exact: true });
  await dailyToggle.click();
  const daily = page.getByRole("region", { name: "History daily data", exact: true });
  await expect(daily.locator("tbody tr")).toHaveCount(31);
  expect(await daily.locator("tbody tr td:first-of-type").allTextContents().then(values => values.reduce((sum, value) => sum + Number(value.replaceAll(",", "")), 0))).toBe(1234);
  await dailyToggle.click();
  const requestCount = requests.length, chart = page.locator("svg.recharts-surface:visible");
  await chart.focus(); await page.keyboard.press("ArrowRight");
  await expect(page.locator(".recharts-tooltip-wrapper:visible")).toContainText("Retained calls");
  await expect(register).toContainText("617"); await expect(register).toContainText("100%");
  if (capture) await mkdir(directory, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator("main").evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
      expect(await chart.evaluate(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; })).toBe(true);
      if (capture) await page.screenshot({ path: `${directory}/history-${width}-${theme}.png`, animations: "disabled" });
      const button = register.getByRole("button", { name: members[1].name, exact: true });
      await button.focus(); await page.keyboard.press("Enter");
      const sheet = width >= 1200 ? page.getByRole("complementary", { name: members[1].name, exact: true }) : page.getByRole("dialog");
      await expect(sheet).toContainText("1,234"); await expect(sheet).toContainText("617"); await expect(sheet).toContainText("100%");
      await expect(sheet.locator("svg.recharts-surface")).toBeVisible();
      if (capture) await page.screenshot({ path: `${directory}/detail-${width}-${theme}.png`, animations: "disabled" });
      if (width >= 1200) await sheet.getByRole("button", { name: "Close", exact: true }).click(); else { await page.keyboard.press("Tab"); expect(await sheet.evaluate(node => node.contains(document.activeElement))).toBe(true); await page.keyboard.press("Escape"); }
      await expect(button).toBeFocused();
    }
  }
  expect(requests.length).toBe(requestCount); expect(warnings).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await register.getByRole("button", { name: members[1].name, exact: true }).click();
  const rail = page.getByRole("complementary", { name: members[1].name, exact: true });
  await page.getByLabel("Record type").selectOption("visits");
  await expect(rail).toContainText("1,234");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(rail).toContainText("Retained visits"); await expect(rail).toContainText("93");
  await page.getByLabel("Record type").selectOption("mappings_completed");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(rail).toContainText("Mapping"); await expect(rail).toContainText("snapshot");
  await rail.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Employee scope").selectOption(employee);
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(register.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: new RegExp(`${members[1].name} ·`) })).toBeVisible();
  fail = true;
  await page.getByLabel("From (IST)").fill(addISTDateDays(today, -6));
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Previous applied report remains visible");
  await expect(page.getByRole("heading", { name: new RegExp(`${members[1].name} · ${addISTDateDays(today, -31)}`) })).toBeVisible();
  fail = false; stall = true;
  await page.clock.install();
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await page.clock.fastForward(12001);
  await expect(page.getByRole("alert")).toContainText("History took too long");
  await expect(page.getByRole("button", { name: "Apply range", exact: true })).toBeEnabled();
  stall = false; unavailable = true;
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(page.getByText("Chart unavailable: selected source was not read completely.", { exact: true })).toBeVisible();
  await expect(register).toContainText("Unavailable");
  await testInfo.attach("history-observations", { body: JSON.stringify({ requests, warnings, fixture: "1234 current and 617 previous synthetic Calls; 31 dates; 93 Visit/Mapping observations" }), contentType: "application/json" });
});

test("My Day mounts only self history and never requests Team or Pipeline data", async ({ page }, testInfo) => {
  const requests = await setup(page);
  await page.route("**/api/my-day/history?**", route => {
    const generatedAt = new Date().toISOString(), scope = parseHistoryScope(new URL(route.request().url()).searchParams, generatedAt)!;
    return route.fulfill({ json: buildHistoryReport({ scope, generatedAt, self: true, members: [{ user_id: actor, name: "Asha Mehta", role: "Your retained records" }], calls: [], events: [], requests: 1 }) });
  });
  await page.goto("/my-day");
  await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(requests.some(value => value.startsWith("/api/my-day/history"))).toBe(false);
  await page.getByRole("tab", { name: "My history", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Your confirmed records/ })).toBeVisible();
  await expect(page.getByLabel("Employee scope")).toHaveCount(0);
  await expect(page.getByLabel("Record type").locator("option")).toHaveCount(2);
  await page.getByLabel("Record type").selectOption("visits");
  expect(requests.filter(value => value.startsWith("/api/my-day/history"))).toHaveLength(1);
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Retained visits by IST date", exact: true })).toBeVisible();
  expect(requests.filter(value => value.startsWith("/api/my-day/history"))).toHaveLength(2);
  expect(requests.some(value => value.startsWith("/api/team-kpi") || value.startsWith("/api/pipeline"))).toBe(false);
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await testInfo.attach("self-request-scope", { body: JSON.stringify(requests), contentType: "application/json" });
});
