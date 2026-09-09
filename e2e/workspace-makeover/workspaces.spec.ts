import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { leads, report, setup, tasks, today, visits } from "./fixtures";

for (const [name, path, record] of [["my-day", "/my-day", "Review the assigned client documents"], ["visits", "/admin/visits", "Acme Medical and General Stores"], ["team", "/manager/kpi", "Asha Mehta"], ["pipeline", "/onboarding", "Acme Medical and General Stores"]]) {
test(`populated ${name} desktop and mobile review`, async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(name === "team" ? page.getByRole("button", { name: record, exact: true }) : page.getByText(record, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(name === "team" ? page.getByRole("button", { name: record, exact: true }) : page.getByText(record, { exact: false }).first()).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      if (name === "pipeline") expect((await page.getByRole("searchbox").boundingBox())!.width).toBeGreaterThan(180);
      if (process.env.WORKSPACE_CAPTURE) { const directory = `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}`; await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${name}-${width}${theme === "dark" ? "-dark" : ""}.png`, animations: "disabled" }); }
    }
    }
});
}

test("populated Admin inspection review", async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/manager/kpi");
  await page.getByRole("tab", { name: "Pipeline inspection" }).click();
  await expect(page.getByText("Acme Medical and General Stores", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByText("Acme Medical and General Stores", { exact: true })).toBeInViewport();
    if (process.env.WORKSPACE_CAPTURE) await page.screenshot({ path: `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}/admin-pipeline-${width}.png`, animations: "disabled" });
  }
});

test("My Day view counts, linked work and keyboard context preserve real task identity", async ({ page }) => {
  const requests = await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/my-day");
  const agenda = page.getByRole("region", { name: "Work agenda" });
  await expect(agenda.getByRole("button", { name: tasks[1].title, exact: true })).toBeVisible({ timeout: 30_000 });
  for (const [view, task] of [["Overdue", tasks[0]], ["Today", tasks[1]], ["Later", tasks[2]], ["Done", tasks[3]]] as const) {
    await agenda.getByRole("tab", { name: `${view} 1`, exact: true }).click();
    await expect(agenda.getByRole("button", { name: task.title, exact: true })).toBeVisible();
    expect(await agenda.getByRole("button", { name: "Done ✓", exact: true }).count()).toBe(view === "Done" ? 0 : 1);
  }
  await agenda.getByRole("tab", { name: "Overdue 1" }).click();
  const trigger = agenda.getByRole("button", { name: tasks[0].title, exact: true });
  await trigger.focus(); await page.keyboard.press("Enter");
  const rail = page.getByRole("complementary", { name: tasks[0].title });
  await expect(rail).toContainText("exact linked lead");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await rail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 900 });
  await trigger.click();
  await expect(page.getByRole("dialog")).toContainText(tasks[0].title);
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(page.getByRole("button", { name: "Export pipeline" })).toHaveCount(0);
  expect(requests.some(path => path.startsWith("/api/pipeline"))).toBe(false);
});

test("Visits retains applied page and selected UUID through failed filters; details do not fetch evidence", async ({ page }) => {
  const requests = await setup(page);
  let fail = false;
  const registerRequests: URLSearchParams[] = [];
  await page.route("**/api/admin/visits?**", route => {
    registerRequests.push(new URL(route.request().url()).searchParams);
    if (fail) return route.fulfill({ status: 503, json: { error: "Fixture refresh unavailable" } });
    const number = Number(new URL(route.request().url()).searchParams.get("page") || 1);
    return route.fulfill({ json: { visits: [visits[number - 1]], page: number, total: 2, has_more: number === 1, all_time_total: 127, today_total: 12, representatives: [] } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/visits");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const record = page.getByRole("button", { name: leads[1].business_name, exact: true });
  await expect(record).toBeVisible();
  await record.click();
  const rail = page.getByRole("complementary", { name: leads[1].business_name, exact: true });
  await expect(rail).toContainText("Page 2");
  fail = true;
  await page.getByRole("textbox", { name: "Search visits", exact: true }).fill("no match");
  expect(registerRequests).toHaveLength(2);
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Fixture refresh unavailable" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Outcome composition" })).toContainText("Current bounded page 2");
  await expect(record).toBeVisible();
  await expect(rail).toContainText("Page 2");
  expect(requests.some(path => path.includes("/evidence"))).toBe(false);
  await rail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(record).toBeFocused();
  await page.getByRole("button", { name: "Retry request", exact: true }).click();
  await expect.poll(() => registerRequests.length).toBe(4);
  expect(registerRequests[2].get("page")).toBe("1");
  expect(registerRequests[3].get("page")).toBe("1");
  expect(registerRequests[3].get("search")).toBe("no match");
  fail = false;
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("button", { name: leads[0].business_name, exact: true })).toBeVisible();
  expect(registerRequests.at(-1)!.has("search")).toBe(false);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(record).toBeVisible();
  expect(registerRequests.at(-1)!.get("page")).toBe("2");
  expect(registerRequests.at(-1)!.has("search")).toBe(false);
});

test("Visits background refresh cannot replace a pending Apply", async ({ page }) => {
  await setup(page);
  const queries: URLSearchParams[] = [];
  let release: (() => void) | undefined;
  await page.route("**/api/admin/visits?**", async route => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    if (query.has("search")) await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { visits: [visits[0]], page: 1, total: 1, has_more: false, representatives: [] } });
  });
  await page.goto("/admin/visits");
  await expect(page.getByRole("button", { name: leads[0].business_name, exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search visits", exact: true }).fill("Acme");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  release!();
  await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeEnabled();
  await expect(page.getByText(/Applied:.*Search: Acme/)).toBeVisible();
  expect(queries).toHaveLength(2);
});

test("Visits export captures applied filters and cannot download after workspace unmount", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => original(input, String(input).includes("/export-visits") ? { ...init, signal: undefined } : init);
  });
  let release: (() => void) | undefined;
  let query: URLSearchParams | undefined;
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.route("**/api/admin/export-visits?**", async route => {
    query = new URL(route.request().url()).searchParams;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: "synthetic export" });
  });
  await page.goto("/admin/visits");
  await expect(page.getByRole("button", { name: "Export to Excel" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Search visits", exact: true }).fill("unapplied draft");
  await page.getByRole("button", { name: "Export to Excel" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  expect(query!.has("search")).toBe(false);
  await page.getByRole("link", { name: "My Day", exact: true }).first().click();
  await expect(page).toHaveURL(/\/my-day$/);
  const completed = page.waitForResponse(response => response.url().includes("/export-visits"));
  release!(); await (await completed).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(downloads).toBe(0);
});

test("Pipeline discards delayed A after B, close and timeout without extra snapshot requests", async ({ page }) => {
  test.setTimeout(120_000);
  const requests = await setup(page);
  // Model an asynchronous source which cannot be cancelled: generation checks still must win.
  await page.addInitScript(() => { const original = window.fetch; window.fetch = (input, init) => original(input, String(input).includes("/context") ? { ...init, signal: undefined } : init); });
  const held: Array<{ id: string; release: () => void }> = [];
  await page.route("**/api/pipeline/leads/*/context", async route => {
    const lead = leads.find(row => route.request().url().includes(row.lead_id))!;
    await new Promise<void>(resolve => held.push({ id: lead.lead_id, release: resolve }));
    await route.fulfill({ json: { lead, stage_age_days: lead === leads[0] ? 101 : 202, transitions: [], next_task: { title: `Context for ${lead.business_name}`, due_date: today }, overdue_tasks: [], recent_tasks: [], latest_call: null, recent_calls: [] } }).catch(() => {});
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/onboarding");
  await expect(page.getByText(leads[0].business_name, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "List", exact: true }).click();
  const list = page.getByRole("region", { name: "Pipeline lead list" });
  await list.getByText(leads[0].business_name, { exact: true }).click();
  await expect.poll(() => held.length).toBe(1);
  await list.getByText(leads[1].business_name, { exact: true }).click();
  await expect.poll(() => held.length).toBe(2);
  held[1].release();
  const rail = page.getByRole("complementary", { name: leads[1].business_name, exact: true });
  await expect(rail).toContainText("202 days");
  const delayedA = page.waitForResponse(response => response.url().includes(leads[0].lead_id) && response.url().includes("/context"));
  held[0].release(); await (await delayedA).finished();
  await expect(rail).not.toContainText("101 days");
  await expect(rail).not.toContainText("Move to");
  await list.getByText(leads[0].business_name, { exact: true }).click();
  await expect.poll(() => held.length).toBe(3);
  await page.getByRole("complementary", { name: leads[0].business_name, exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  held[2].release();
  await expect(page.locator(".workspace-context")).toHaveCount(0);
  await list.getByText(leads[0].business_name, { exact: true }).click();
  await expect.poll(() => held.length).toBe(4);
  await expect(page.getByRole("alert").filter({ hasText: "Authoritative context unavailable" })).toBeVisible({ timeout: 15_000 });
  held[3].release();
  await expect(page.getByRole("complementary", { name: leads[0].business_name, exact: true })).not.toContainText("101 days");
  expect(requests.filter(path => path.startsWith("/api/pipeline/leads?"))).toHaveLength(1);
});

test("empty and partial workspaces remain honest in dark reduced-motion mode", async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, true);
  await page.setViewportSize({ width: 390, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/my-day");
  await expect(page.getByRole("heading", { name: "No today tasks" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.goto("/admin/visits"); await expect(page.getByText("No confirmed visits match these filters.", { exact: true })).toBeVisible();
  await page.goto("/onboarding"); await page.getByRole("button", { name: "List", exact: true }).click(); await expect(page.getByRole("heading", { name: "No matching leads" })).toBeVisible();
  await page.route("**/api/team-kpi", route => route.fulfill({ json: { ...report, warnings: [{ source: "tasks", message: "Fixture task coverage incomplete" }] } }));
  await page.goto("/manager/kpi");
  await expect(page.getByRole("status").filter({ hasText: "Fixture task coverage incomplete" })).toBeVisible();
  await page.getByRole("button", { name: "Asha Mehta", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Some sources are incomplete");
  await page.keyboard.press("Tab");
  expect(await page.getByRole("dialog").evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Asha Mehta", exact: true })).toBeFocused();
});
