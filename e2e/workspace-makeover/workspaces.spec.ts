import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { actor, employee, leads, report, setup, tasks, today, visits } from "./fixtures";
import { addISTDateDays } from "../../src/lib/dateTime";
import { aggregateVisitRange, parseVisitRange } from "../../src/lib/fieldVisits/range";
import { buildManagementReview, type ReviewTask } from "../../src/lib/teamKpi/review";
import { buildHistoryReport, parseHistoryScope } from "../../src/lib/teamKpi/history";

test("Admin Review is lazy and reconciles current records, employee scope and read-only Missed detail", async ({ page }) => {
  const requests = await setup(page);
  const rows: ReviewTask[] = tasks.map(row => ({ ...row, template_id: null }) as ReviewTask);
  rows.push({ ...rows[0], task_id: "94000000-0000-4000-a000-000000000009", title: "Missed regional service follow-up", status: "Missed", assigned_to: employee });
  const cohort = [{ user_id: actor, name: "Asha Mehta", role: "Field" }, { user_id: employee, name: "Nikhil Rao — Western Regional Field Operations", role: "Field" }];
  let failed = false;
  await page.route("**/api/team-kpi/review?**", route => {
    if (failed) return route.fulfill({ status: 503, json: { message: "Synthetic workload unavailable" } });
    const selected = new URL(route.request().url()).searchParams.get("employee");
    return route.fulfill({ json: buildManagementReview({ members: cohort, employee: selected, today, generatedAt: new Date().toISOString(), tasks: rows,
      targets: [{ target_id: "96000000-0000-4000-a000-000000000001", assigned_to_user_id: actor, target_name: "Western regional allocated client", target_username: "regional-client", city: "Pune", is_completed: false, created_at: `${today}T02:00:00Z` }], taskError: null, targetError: null }) });
  });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/manager/kpi");
  await expect(page.getByRole("button", { name: "Asha Mehta", exact: true })).toBeVisible();
  expect(requests.filter(path => path.startsWith("/api/team-kpi/review"))).toHaveLength(0);
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  const review = page.getByRole("region", { name: "Admin current workload review" });
  await expect(review.getByRole("button", { name: /^Tasks/ })).toHaveText("Tasks · 4");
  const missed = review.getByRole("button", { name: /Missed regional service follow-up/ });
  if (process.env.WORKSPACE_CAPTURE) {
    const directory = `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}`;
    await mkdir(directory, { recursive: true });
    for (const theme of ["light", "dark"]) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 }); await page.getByRole("main").evaluate(node => node.scrollTo(0, 0));
        await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeInViewport();
        await expect(review.getByRole("button", { name: /Confirm the recorded visit/ })).toBeInViewport();
        await page.screenshot({ path: `${directory}/review-${width}-${theme}.png`, animations: "disabled" });
        await missed.click();
        const detail = width >= 1200 ? page.getByRole("complementary", { name: "Missed regional service follow-up", exact: true }) : page.getByRole("dialog");
        await expect(detail).toContainText("Missed is read-only");
        await page.screenshot({ path: `${directory}/review-detail-${width}-${theme}.png`, animations: "disabled" });
        if (width >= 1200) await detail.getByRole("button", { name: "Close", exact: true }).click(); else await page.keyboard.press("Escape");
      }
    }
    await page.getByRole("button", { name: "Use light theme" }).click(); await page.setViewportSize({ width: 1440, height: 900 });
  }
  await missed.click();
  const rail = page.getByRole("complementary", { name: "Missed regional service follow-up", exact: true });
  await expect(rail).toContainText("94000000-0000-4000-a000-000000000009");
  await expect(rail).toContainText("Missed is read-only");
  await expect(rail.getByRole("link", { name: /Open your agenda/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  const sheet = page.getByRole("dialog", { name: "Missed regional service follow-up", exact: true });
  await expect(sheet).toContainText("94000000-0000-4000-a000-000000000009");
  await page.keyboard.press("Escape"); await expect(missed).toBeFocused();
  await expect(page.getByRole("tab", { name: "Review", exact: true })).toBeInViewport();
  await review.getByRole("button", { name: /^Allocated targets/ }).click();
  await expect(review).toContainText("Allocated targets have no recorded due date");
  await expect(review.getByRole("button", { name: /Western regional allocated client/ })).toBeVisible();
  await review.getByRole("combobox", { name: "Current employee", exact: true }).selectOption(employee);
  await review.getByRole("button", { name: "Apply employee", exact: true }).click();
  await expect(review.getByRole("button", { name: /^Allocated targets/ })).toHaveText("Allocated targets · 0");
  await review.getByRole("button", { name: /^Tasks/ }).click(); await expect(missed).toBeVisible();
  await expect(review.getByRole("button", { name: /Confirm the recorded visit/ })).toHaveCount(0);
  failed = true; await review.getByRole("button", { name: "Refresh review", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Previous applied workload remains visible");
  await expect(missed).toBeVisible();
  expect(requests.filter(path => path.startsWith("/api/team-kpi/review"))).toHaveLength(3);
  await page.getByRole("button", { name: "Use dark theme" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("My Day history is lazy, self-only and reconciles retained dates without Pipeline consumption", async ({ page }) => {
  const requests = await setup(page);
  await page.route("**/api/my-day/history?**", route => {
    const generatedAt = new Date().toISOString(), params = new URL(route.request().url()).searchParams;
    expect(params.has("employee")).toBe(false); expect(params.has("user_id")).toBe(false);
    const scope = parseHistoryScope(params, generatedAt)!;
    const calls = Array.from({ length: 124 }, (_, n) => ({ log_id: `self-current-${n}`, user_id: actor, timestamp: `${addISTDateDays(scope.from, n % scope.days)}T04:00:00Z`, outcome: "Contacted" }));
    calls.push(...Array.from({ length: 62 }, (_, n) => ({ log_id: `self-prior-${n}`, user_id: actor, timestamp: `${addISTDateDays(scope.previous_from, n % scope.days)}T04:00:00Z`, outcome: "Contacted" })));
    return route.fulfill({ json: buildHistoryReport({ scope, generatedAt, members: [{ user_id: actor, name: "Asha Mehta", role: "Self" }], calls, requests: 3, self: true }) });
  });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/my-day");
  await expect(page.getByRole("heading", { name: "Coming up", exact: true })).toBeVisible();
  expect(requests.some(path => path.startsWith("/api/my-day/history"))).toBe(false);
  await page.getByRole("tab", { name: "My history", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Your confirmed records/ })).toBeVisible();
  await page.getByLabel("From (IST)").fill(addISTDateDays(today, -31));
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Your confirmed records.*${addISTDateDays(today, -31)}`) })).toBeVisible();
  await page.getByText("Exact daily data · chart and previous retained records", { exact: true }).click();
  const daily = page.getByRole("region", { name: "History daily data", exact: true });
  await expect(daily.locator("tbody tr")).toHaveCount(31);
  expect(await daily.locator("tbody tr td:first-of-type").allTextContents().then(values => values.reduce((sum, value) => sum + Number(value), 0))).toBe(124);
  await page.getByText("Exact daily data · chart and previous retained records", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Employee scope" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Record type" }).locator('option[value="mappings_completed"]')).toHaveCount(0);
  for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.getByRole("main").evaluate(node => node.scrollTo(0, 0));
      await expect(page.locator("svg.recharts-surface:visible")).toBeInViewport();
      if (process.env.WORKSPACE_CAPTURE) {
        const directory = `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}`; await mkdir(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/my-day-history-${width}-${theme}.png`, animations: "disabled" });
      }
    }
  }
  expect(requests.filter(path => path.startsWith("/api/my-day/history"))).toHaveLength(2);
  expect(requests.some(path => path.startsWith("/api/team-kpi") || path.startsWith("/api/pipeline"))).toBe(false);
});

test("Visits full-range chart reconciles 31 busy dates without pager or refresh fanout", async ({ page }) => {
  test.setTimeout(120_000);
  const requests = await setup(page);
  const rows = Array.from({ length: 80 }, (_, index) => ({ ...visits[index % visits.length],
    visit_id: `95000000-0000-4000-a000-${String(index + 1).padStart(12, "0")}`,
    visit_date: addISTDateDays(today, -(index % 31)),
    check_in_time: `${addISTDateDays(today, -(index % 31))}T04:00:00Z`,
    leads: { ...leads[index % leads.length], business_name: index ? `Retained business ${index} — Western Regional Pharmaceutical Distribution and Service Centre` : leads[0].business_name },
    users: { name: "Asha Mehta — Western Region Field Operations and Service Coordination", email: "asha@example.test" },
  }));
  const matchedRows = (params: URLSearchParams) => rows.filter(row => row.visit_date >= params.get("date_from")! && row.visit_date <= params.get("date_to")!
    && (!params.has("outcome") || row.visit_outcome === params.get("outcome"))
    && (!params.has("representative") || row.user_id === params.get("representative"))
    && (!params.has("segment") || row.segment_type === params.get("segment"))
    && (!params.has("search") || [row.leads.business_name, row.users.name, row.visit_notes].some(value => value.toLowerCase().includes(params.get("search")!.toLowerCase()))));
  await page.route("**/api/admin/visits?**", route => {
    const params = new URL(route.request().url()).searchParams, number = Number(params.get("page") || 1);
    const matched = matchedRows(params);
    return route.fulfill({ json: { visits: matched.slice((number - 1) * 50, number * 50), total: matched.length, page: number, has_more: number * 50 < matched.length, all_time_total: null, today_total: null } });
  });
  await page.route("**/api/admin/visits/analysis?**", route => {
    const now = new Date().toISOString(), scope = parseVisitRange(new URL(route.request().url()).searchParams, now);
    const aggregate = aggregateVisitRange(scope, matchedRows(new URL(route.request().url()).searchParams));
    return route.fulfill({ json: { kind: "visit-range-v1", scope, generated_at: now, retained_source_read: "exhausted", historical_coverage: "uncertified", consistency: "bounded-live-multi-request", ...aggregate, representatives: aggregate.representatives?.map(row => ({ ...row, name: rows[0].users.name })) } });
  });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/admin/visits");
  const activity = page.getByRole("region", { name: "Full-range Visit activity", exact: true });
  await expect(activity).toBeVisible();
  await page.getByText("Refine representative, outcome and dates", { exact: true }).click();
  await page.getByText("Date and segment filters", { exact: true }).click();
  await page.getByLabel("Date From", { exact: true }).fill(addISTDateDays(today, -30));
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(activity).toContainText("80 retained Visit records · 31 IST business dates");
  await page.getByText("Refine representative, outcome and dates", { exact: true }).click();
  const analysisRequests = () => requests.filter(path => path.startsWith("/api/admin/visits/analysis?")).length;
  expect(analysisRequests()).toBe(2);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/Applied:.*Loaded page 2/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply filters", exact: true })).toBeEnabled();
  expect(analysisRequests()).toBe(2);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByText("Exact daily chart data", { exact: true }).click();
  const daily = activity.getByRole("table");
  await expect(daily.locator("tbody tr")).toHaveCount(31);
  expect((await daily.locator("tbody td").allTextContents()).reduce((sum, value) => sum + Number(value), 0)).toBe(80);
  await page.getByText("Exact daily chart data", { exact: true }).click();
  await expect(page.getByText("Legacy unknown", { exact: true }).first()).toBeVisible();
  for (const theme of ["light", "dark"]) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: `Use ${theme} theme` }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.getByRole("main").evaluate(node => node.scrollTo(0, 0));
      await expect(page.getByRole("button", { name: leads[0].business_name, exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      if (process.env.WORKSPACE_CAPTURE) {
        const directory = `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}`;
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/visits-busy-${width}-${theme}.png`, animations: "disabled" });
        if (width === 390) await page.getByRole("tab", { name: "Analysis", exact: true }).click();
        await activity.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${directory}/visits-range-${width}-${theme}.png`, animations: "disabled" });
        if (width === 390) await page.getByRole("tab", { name: "Work", exact: true }).click();
      }
    }
  }
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  const refresh = page.getByRole("button", { name: "Refresh analysis", exact: true });
  await refresh.focus(); await page.keyboard.press("Enter"); await expect(refresh).toBeEnabled();
  expect(analysisRequests()).toBe(3);
  await page.getByRole("button", { name: "Filter outcome: Follow-up", exact: true }).click();
  await expect(page.getByText(/Applied:.*Follow-up.*Loaded page 1.*20 of 20/)).toBeVisible();
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  await expect(activity).toContainText("20 retained Visit records");
  expect(analysisRequests()).toBe(4);
  await page.getByText("Representative context · retained Visit authors", { exact: true }).click();
  await activity.getByRole("button", { name: `${rows[0].users.name} · 20 retained visits`, exact: true }).click();
  await expect(page.getByText(new RegExp(`Applied:.*${rows[0].user_id}.*Loaded page 1`))).toBeVisible();
  await page.getByRole("tab", { name: "Analysis", exact: true }).click();
  await expect(activity).toContainText("20 retained Visit records");
  expect(analysisRequests()).toBe(5);
  for (const endpoint of ["/api/admin/visits?", "/api/admin/visits/analysis?"]) {
    const params = new URL(`http://fixture.invalid${requests.filter(path => path.startsWith(endpoint)).at(-1)!}`).searchParams;
    expect(params.get("representative")).toBe(rows[0].user_id); expect(params.get("outcome")).toBe("follow_up");
    if (endpoint === "/api/admin/visits?") expect(params.get("page")).toBe("1");
  }
  await page.route("**/api/admin/visits/analysis?**", route => route.fulfill({ status: 503, json: { code: "VISIT_SOURCE_LIMIT" } }));
  await refresh.click(); await expect(page.getByRole("status").filter({ hasText: "Range analysis unavailable" })).toBeVisible();
  await expect(activity).toHaveCount(0);
  await page.getByRole("tab", { name: "Work", exact: true }).click();
  await expect(page.getByRole("button", { name: leads[0].business_name, exact: true })).toBeVisible();
});

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
      if (process.env.WORKSPACE_CAPTURE && (!process.env.WORKSPACE_CAPTURE_ONLY || process.env.WORKSPACE_CAPTURE_ONLY === name)) { const directory = `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}`; await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${name}-${width}${theme === "dark" ? "-dark" : ""}.png`, animations: "disabled" }); }
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
    if (process.env.WORKSPACE_CAPTURE && (!process.env.WORKSPACE_CAPTURE_ONLY || process.env.WORKSPACE_CAPTURE_ONLY === "admin-pipeline")) await page.screenshot({ path: `artifacts/visual-review/workspace-makeover/${process.env.WORKSPACE_CAPTURE}/admin-pipeline-${width}.png`, animations: "disabled" });
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

test("Visits representative search is lazy and independent of register paging, retaining selection outside search", async ({ page }) => {
  const requests = await setup(page);
  const pickerRequests: URLSearchParams[]=[];
  const current={user_id:"95000000-0000-4000-a000-000000000001",name:"Current field employee",email:"current@example.test",is_active:true,historical_only:false};
  const former={user_id:"95000000-0000-4000-a000-000000000002",name:"Former field employee with a long retained identity",email:"former@example.test",is_active:false,historical_only:true};
  await page.route(url=>url.pathname==="/api/admin/visits/representatives",route=>{
    const params=new URL(route.request().url()).searchParams; pickerRequests.push(params);
    return route.fulfill({json:{items:params.get("search") ? [former] : [current],selected:params.get("selected")===current.user_id ? current : null,next_cursor:null}});
  });
  await page.goto("/admin/visits");
  await expect(page.getByText("Acme Medical and General Stores",{exact:false}).first()).toBeVisible();
  expect(pickerRequests).toHaveLength(0);
  await page.getByText("Refine representative, outcome and dates", { exact: true }).click();
  const selector=page.getByLabel("Representative",{exact:true});
  await selector.focus();
  await expect(selector.locator("option")).toHaveCount(2);
  await selector.selectOption(current.user_id);
  await page.getByText("Find current or historical representatives",{exact:true}).click();
  await page.getByLabel("Representative name or email").fill("Former");
  expect(pickerRequests).toHaveLength(1);
  await page.getByRole("button",{name:"Search representatives",exact:true}).click();
  await expect(selector.locator("option")).toHaveCount(3);
  await expect(selector).toHaveValue(current.user_id);
  await expect(selector.locator(`option[value="${former.user_id}"]`)).toContainText("inactive — historical");
  expect(requests.filter(path=>path.startsWith("/api/admin/visits?"))).toHaveLength(1);
  await page.getByRole("button",{name:"Apply filters",exact:true}).click();
  await expect.poll(()=>requests.filter(path=>path.startsWith("/api/admin/visits?")).length).toBe(2);
  expect(pickerRequests).toHaveLength(2);
  expect(pickerRequests[1].get("selected")).toBe(current.user_id);
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
  await expect(page.getByRole("region", { name: "Outcome composition" })).toContainText("Full applied range");
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

test("Visits evidence cannot open after its selected detail closes, even when transport ignores abort", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => { const original=window.fetch; window.fetch=(input,init)=>original(input,String(input).includes("/evidence?") ? {...init,signal:undefined} : init); });
  let release: (()=>void) | undefined;
  await page.route("**/api/admin/visits?**",route=>route.fulfill({json:{visits:[{...visits[0],selfie_status:"AVAILABLE"}],page:1,total:1,has_more:false,all_time_total:null,today_total:null}}));
  await page.route("**/api/admin/visits/evidence?**",async route=>{ await new Promise<void>(resolve=>{release=resolve;}); await route.fulfill({json:{url:"https://fixture.invalid/synthetic-evidence"}}); });
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/admin/visits");
  await page.evaluate(()=>{ document.documentElement.dataset.evidenceOpens="0"; window.open=()=>{ document.documentElement.dataset.evidenceOpens=String(Number(document.documentElement.dataset.evidenceOpens)+1); return null; }; });
  await page.getByRole("button",{name:leads[0].business_name,exact:true}).click();
  await page.getByRole("button",{name:"View Selfie",exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);
  await page.getByRole("complementary",{name:leads[0].business_name,exact:true}).getByRole("button",{name:"Close",exact:true}).click();
  const completed=page.waitForResponse(response=>response.url().includes("/evidence?"));
  release!(); await (await completed).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(await page.evaluate(()=>document.documentElement.dataset.evidenceOpens)).toBe("0");
  await page.getByText("Global visit context",{exact:true}).click();
  await expect(page.locator(".workspace-counts")).toContainText("Unavailable");
});

test("Pipeline confirmation invalidates an older snapshot and keeps exact context across the Sheet breakpoint", async ({ page }) => {
  const requests = await setup(page);
  await page.addInitScript(() => { const original = window.fetch; window.fetch = (input, init) => original(input, String(input).includes("/api/pipeline/leads?") ? { ...init, signal: undefined } : init); });
  let current = { ...leads[0] }, reads = 0, contexts = 0, writes = 0;
  let releaseOld: (() => void) | undefined, releaseContext: (() => void) | undefined;
  await page.route("**/api/pipeline/leads?**", async route => {
    const snapshot = { ...current }; reads++;
    if (reads === 2) await new Promise<void>(resolve => { releaseOld = resolve; });
    await route.fulfill({ json: { leads: [snapshot], total: 1, page: 1, has_more: false, stages: [{ stage: snapshot.status, count: 1 }], recovery: { operations: [], safe_replay_targets: [] } } });
  });
  await page.route("**/api/pipeline/leads/*/context", async route => {
    contexts++; const snapshot = { ...current };
    if (contexts === 2) await new Promise<void>(resolve => { releaseContext = resolve; });
    await route.fulfill({ json: { lead: snapshot, stage_age_days: snapshot.status === "New" ? 9 : 0,
      transitions: snapshot.status === "New" ? [] : [{ expected_stage: "New", target_stage: "Contacted", confirmed_at: new Date().toISOString() }],
      next_task: { title: snapshot.status === "New" ? "Before confirmation" : "Post-confirmed context", due_date: today }, overdue_tasks: [], recent_tasks: [], latest_call: null, recent_calls: [] } });
  });
  await page.route("**/api/pipeline/transition", route => {
    writes++; const command = route.request().postDataJSON();
    expect(command).toMatchObject({ actor_id: actor, lead_id: leads[0].lead_id, expected_stage: "New", target_stage: "Contacted" });
    current = { ...current, status: "Contacted" };
    return route.fulfill({ json: { success: true, operation_id: command.operation_id, lead: current } });
  });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/onboarding");
  await page.getByRole("button", { name: "List", exact: true }).click();
  const trigger = page.getByRole("region", { name: "Pipeline lead list" }).getByText(leads[0].business_name, { exact: true });
  await trigger.click();
  const rail = page.getByRole("complementary", { name: leads[0].business_name, exact: true });
  await expect(rail).toContainText("Before confirmation");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => Boolean(releaseOld)).toBe(true);
  await rail.getByRole("button", { name: "Move to Contacted", exact: true }).click();
  await expect.poll(() => reads).toBe(3); await expect.poll(() => Boolean(releaseContext)).toBe(true);
  await page.setViewportSize({ width: 390, height: 900 });
  const sheet = page.getByRole("dialog", { name: leads[0].business_name, exact: true });
  await expect(sheet.getByRole("button", { name: "Move to Interested", exact: true })).toBeVisible();
  releaseContext!(); await expect(sheet).toContainText("Post-confirmed context");
  const oldResponse = page.waitForResponse(response => response.url().includes("/api/pipeline/leads?"));
  releaseOld!(); await (await oldResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(sheet.getByRole("button", { name: "Move to Contacted", exact: true })).toHaveCount(0);
  await expect(sheet).toContainText("Post-confirmed context");
  const cachedStage = await page.evaluate(async id => {
    const open = indexedDB.open("CRMDatabase"); const database = await new Promise<IDBDatabase>(resolve => { open.onsuccess = () => resolve(open.result); });
    try { const get = database.transaction("leads").objectStore("leads").get(id); return await new Promise<string>(resolve => { get.onsuccess = () => resolve(get.result.status); }); } finally { database.close(); }
  }, leads[0].lead_id);
  expect(cachedStage).toBe("Contacted"); expect(writes).toBe(1); expect(contexts).toBe(2); expect(reads).toBe(3);
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  expect(requests.some(path => path.startsWith("/api/team-kpi"))).toBe(false);
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
