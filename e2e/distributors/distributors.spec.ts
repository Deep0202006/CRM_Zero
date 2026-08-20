import { expect, test, type Page } from "@playwright/test";

const admin = "10000000-0000-4000-a000-000000000003";
const employee = "10000000-0000-4000-a000-000000000011";
const distributorId = "40000000-0000-4000-a000-000000000001";
function token(id: string) { const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url"); return `${encode({ alg: "none" })}.${encode({ sub: id, exp: 1999999999 })}.e2e`; }
async function seed(page: Page, id: string, isAdmin: boolean) {
  await page.goto("/login");
  await page.waitForTimeout(300);
  await page.evaluate(async ({ id, accessToken, isAdmin }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction(["users", "user_capabilities"], "readwrite");
    transaction.objectStore("users").put({ user_id: id, name: isAdmin ? "Admin User" : "Employee", email: "user@example.test", is_active: 1, created_at: new Date().toISOString() });
    if (isAdmin) transaction.objectStore("user_capabilities").put({ id: `${id}-cap`, user_id: id, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close(); localStorage.setItem("authenticated_user_id", id); localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e", expires_at: 1999999999, expires_in: 999999999, token_type: "bearer", user: { id, aud: "authenticated", role: "authenticated", email: "user@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { id, accessToken: token(id), isAdmin });
}
const row = { distributor_id: distributorId, distributor_name: "Alpha Distributor", distributor_reference: "ALPHA-1", lead_id: null, phone: null, city: "Delhi", assigned_to: employee, assigned_employee_name: "Employee", installation_status: "done", installation_completed_at: "2026-08-01", training_status: "done", training_completed_at: "2026-08-02", mapping_status: "done", mapped_at: "2026-08-03", activity_status: "active", billing_status: "billed", billed_at: "2026-08-03", bill_reference: "INV-1", renewal_date: "2026-08-14", renewal_state: "renewal_due_tomorrow", version: 2, updated_at: "2026-08-13T06:00:00Z", active_receivable_count: 1, total_bill_amount: "1000.00", confirmed_collected_amount: "400.00", outstanding_amount: "600.00", pending_verification_count: 0, collection_state: "PARTIALLY_PAID", billing_collection_mismatch: false };
const numericProjectionRow = { ...row, total_bill_amount: 1000, confirmed_collected_amount: 400, outstanding_amount: 600 };
test("Admin Distributor import preview shows the server-resolved operational employee", async ({ page }) => {
  await mock(page); await page.route("**/api/distributors/import", route => route.fulfill({ json: { rows: [{ rowNumber: 2, distributorName: "Alpha", assignedEmployeeEmail: "zerodata_vaibhav@zerodata.local", assigned_employee_name: "Vaibhav Patel", classification: "NEW" }], counts: { NEW: 1 }, preview_hash: "a".repeat(64) } }));
  await seed(page, admin, true); await page.goto("/admin/payments/distributors"); await page.getByRole("button", { name: "Import" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "distributors.csv", mimeType: "text/csv", buffer: Buffer.from("Distributor Name,Assigned Employee Email,Installation Status,Installation Date,Training Status,Training Date,Mapping Status,Mapped Date,Activity Status,Billing Status,Bill Date,Bill Reference,Renewal Date,Distributor Reference\nAlpha,zerodata_vaibhav@zerodata.local,pending,,pending,,pending,,not_applicable,not_billed,,,,ALPHA\n") });
  await expect(page.getByText("Vaibhav Patel")).toBeVisible(); await expect(page.getByRole("cell", { name: "NEW", exact: true })).toBeVisible();
});
async function mock(page: Page) {
  await page.route("https://e2e.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/distributors/metrics", (route) => route.fulfill({ json: { metrics: { total: 1, installation_pending: 0, training_pending: 0, installation_training_done: 1, mapped: 1, active: 1, inactive: 0, billed: 1 }, assignees: [{ user_id: employee, name: "Employee", email: "employee@example.test" }] } }));
  await page.route(`**/api/distributors/${distributorId}`, (route) => route.fulfill({ json: { record: row, events: [] } }));
  await page.route(`**/api/distributors/${distributorId}/receivables`, (route) => route.fulfill({ json: { total: 1, rows: [{ receivable_id: "50000000-0000-4000-a000-000000000001", bill_reference: "INV-1", outstanding_amount: "600.00", version: 3, pending_payment_count: 0 }], limit: 50, has_more: false } }));
  await page.route("**/api/distributors?**", (route) => route.fulfill({ json: { rows: [numericProjectionRow], page: 1, pageSize: 50, total: 1 } }));
}

test("Distributor Collections exposes read-only money and reuses exact Receivables commands", async ({ page }) => {
  await mock(page); const commands: Array<Record<string, unknown>> = [];
  await page.route("**/api/receivables/commands", async route => { commands.push(route.request().postDataJSON()); await route.fulfill({ json: { success: true } }); });
  await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  const distributorRow = page.getByRole("row").filter({ hasText: "Alpha Distributor" });
  await expect(distributorRow).toContainText("PARTIALLY PAID");
  await expect(distributorRow).toContainText("₹400");
  await expect(distributorRow).toContainText("₹600");
  await distributorRow.getByRole("button", { name: "New Receivable" }).click();
  const create = page.getByRole("dialog", { name: "New Receivable" });
  await expect(create).toContainText("Alpha Distributor · ALPHA-1");
  await create.getByLabel("Bill / Invoice Reference").fill("INV-2");
  await create.getByLabel("Contact Person").fill("Owner");
  await create.getByLabel("Bill Amount").fill("500");
  await create.getByLabel("Bill Due Date").fill("2099-01-01");
  await create.getByLabel("Payment Follow-up Date").fill("2099-01-01");
  await create.getByRole("button", { name: "Create Receivable" }).click();
  expect(commands[0]).toMatchObject({ operation_type: "create", payload: { distributor_id: distributorId, distributor_name: "Alpha Distributor", distributor_code: "ALPHA-1", assigned_to: employee } });
  await distributorRow.getByRole("button", { name: "Record Payment" }).click();
  const payment = page.getByRole("dialog", { name: "Record Payment" });
  await payment.getByLabel("Amount").fill("100");
  await payment.getByRole("button", { name: "Confirm" }).click();
  expect(commands[1]).toMatchObject({ operation_type: "direct_payment", payload: { receivable_id: "50000000-0000-4000-a000-000000000001", expected_version: 3 } });
});

test("multiple outstanding invoices require exact selection before payment", async ({ page }) => {
  await mock(page); const commands: Array<Record<string, unknown>> = [];
  await page.unroute(`**/api/distributors/${distributorId}/receivables`);
  await page.route(`**/api/distributors/${distributorId}/receivables`, route => route.fulfill({ json: { total: 2, rows: [{ receivable_id: "50000000-0000-4000-a000-000000000001", bill_reference: "INV-1", outstanding_amount: "600.00", version: 3, pending_payment_count: 0 }, { receivable_id: "50000000-0000-4000-a000-000000000002", bill_reference: "INV-2", outstanding_amount: "300.00", version: 7, pending_payment_count: 0 }], limit: 50, has_more: false } }));
  await page.route("**/api/receivables/commands", async route => { commands.push(route.request().postDataJSON()); await route.fulfill({ json: { success: true } }); });
  await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  await page.getByRole("row").filter({ hasText: "Alpha Distributor" }).getByRole("button", { name: "Record Payment" }).click();
  const selection = page.getByRole("dialog", { name: "Select exact Receivable" });
  await expect(selection).toBeVisible(); expect(commands).toHaveLength(0);
  await selection.getByRole("button", { name: /INV-2/ }).click();
  const payment = page.getByRole("dialog", { name: "Record Payment" });
  await payment.getByLabel("Amount").fill("50");
  await payment.getByRole("button", { name: "Confirm" }).click();
  expect(commands[0]).toMatchObject({ operation_type: "direct_payment", payload: { receivable_id: "50000000-0000-4000-a000-000000000002", expected_version: 7 } });
});

async function mockRenewals(page: Page, renewalRows = [row]) {
  await page.route("https://e2e.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route(`**/api/distributors/${distributorId}`, (route) => route.fulfill({ json: { record: row, events: [] } }));
  await page.route("**/api/distributors/renewals?**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "metrics") return route.fulfill({ json: { enabled: true, metrics: { overdue: 1, today: 2, tomorrow: 3, in_two_days: 4 } } });
    return route.fulfill({ json: { enabled: true, rows: renewalRows, page: 1, page_size: 50, total: renewalRows.length } });
  });
}

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "tablet", width: 820, height: 900 }, { name: "mobile", width: 390, height: 844 }]) test(`Admin cards preserve mapped overlap on ${viewport.name}`, async ({ page }) => {
  await page.setViewportSize(viewport); await mock(page); await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  for (const label of [/Installation \+ Training Done/, /Mapped/, /Active/, /Billed/]) await expect(page.getByRole("button", { name: label })).toContainText("1");
  await expect(page.getByText("Renewal tomorrow")).toBeVisible();
});

test("Admin edit exposes assignment, mapping and independent status controls", async ({ page }) => {
  await mock(page); await page.route("**/api/distributors/commands", (route) => route.fulfill({ json: { success: true, record: { ...row, version: 3 } } })); await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  await page.getByRole("button", { name: "Edit Alpha Distributor" }).click(); const dialog = page.getByRole("dialog");
  await expect(dialog.locator('select[name="assigned_to"] option')).toHaveCount(2);
  await expect(dialog.locator('select[name="mapping_status"]')).toHaveValue("done");
  await expect(dialog.locator('input[name="mapped_at"]')).toHaveValue("2026-08-03");
  await expect(dialog).toContainText("does not create or modify a Receivable");
});

test("Admin Set Renewal sends the minimal renewal command", async ({ page }) => {
  await mock(page); let commandBody = "";
  await page.route("**/api/distributors/commands", async (route) => { commandBody = route.request().postData() ?? "{}"; await route.fulfill({ json: { success: true, record: { ...row, renewal_date: "2026-09-01", version: 3 } } }); });
  await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  await page.getByRole("button", { name: "Edit Alpha Distributor" }).click(); const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="renewal_date"]').fill("2026-09-01"); await dialog.getByRole("button", { name: "Set Renewal" }).click();
  const command = JSON.parse(commandBody) as { operation_type: string; payload: Record<string, unknown> };
  expect(command).toMatchObject({ operation_type: "renew", payload: { distributor_id: distributorId, expected_version: 2, renewal_date: "2026-09-01" } });
  expect(Object.keys(command.payload).sort()).toEqual(["distributor_id", "expected_version", "note", "renewal_date"]);
});

test("Admin Save Status sends the complete versioned operational command", async ({ page }) => {
  await mock(page); let commandBody = "";
  await page.route("**/api/distributors/commands", async (route) => { commandBody = route.request().postData() ?? "{}"; await route.fulfill({ json: { success: true, record: { ...row, activity_status: "inactive", billing_status: "not_billed", version: 3 } } }); });
  await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  await page.getByRole("button", { name: "Edit Alpha Distributor" }).click(); const dialog = page.getByRole("dialog");
  await dialog.locator('select[name="activity_status"]').selectOption("inactive"); await dialog.locator('select[name="billing_status"]').selectOption("not_billed");
  await dialog.getByRole("button", { name: "Save Status" }).click();
  const command = JSON.parse(commandBody) as { operation_type: string; payload: Record<string, unknown> };
  expect(command.operation_type).toBe("update");
  expect(command.payload).toMatchObject({ distributor_id: distributorId, expected_version: 2, assigned_to: employee, mapping_status: "done", activity_status: "inactive", billing_status: "not_billed" });
});

test("Admin distributor editor is keyboard reachable", async ({ page }) => {
  await mock(page); await seed(page, admin, true); await page.goto("/admin/payments/distributors");
  const edit = page.getByRole("button", { name: "Edit Alpha Distributor" }); await edit.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("assigned employee manually updates canonical renewal with minimal versioned command", async ({ page }) => {
  await mock(page); let commandBody = "";
  await page.route("**/api/distributors/commands", async (route) => { commandBody = route.request().postData() ?? "{}"; await route.fulfill({ json: { success: true, record: { ...row, renewal_date: "2026-09-01", version: 3 } } }); });
  await seed(page, employee, false); await page.goto("/payments/distributors");
  await expect(page.getByText("Alpha Distributor")).toBeVisible(); await page.getByRole("button", { name: "Edit Renewal" }).click();
  await page.getByLabel("Next Renewal Date").fill("2026-09-01"); await page.getByRole("button", { name: "Confirm Renewal" }).click();
  const command = JSON.parse(commandBody) as { operation_type: string; payload: Record<string, unknown> };
  expect(command).toMatchObject({ operation_type: "renew", payload: { distributor_id: distributorId, expected_version: 2, renewal_date: "2026-09-01" } });
  expect(Object.keys(command.payload).sort()).toEqual(["distributor_id", "expected_version", "note", "renewal_date"]);
  await expect(page.getByRole("button", { name: /Add Distributor|Import|Save Status/ })).toHaveCount(0);
});

test("valid empty employee dataset is active while API failure is visible", async ({ page }) => {
  await page.route("https://e2e.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" })); await seed(page, employee, false);
  await page.route("**/api/distributors?**", (route) => route.fulfill({ json: { rows: [], page: 1, pageSize: 50, total: 0 } })); await page.goto("/payments/distributors"); await expect(page.getByText("No distributors are assigned to you.")).toBeVisible();
  await page.route("**/api/distributors?**", (route) => route.fulfill({ status: 503, json: { code: "DISTRIBUTOR_SERVER_ERROR", message: "Distributor records could not be loaded." } })); await page.reload(); await expect(page.getByText("Distributor records could not be loaded.")).toBeVisible();
});

test("employee cannot use the Admin Distributor Status authority surface", async ({ page }) => {
  await page.route("https://e2e.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await seed(page, employee, false);
  await page.goto("/admin/payments/distributors");
  await expect(page.getByText("System Administrator access required.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Add Distributor|Import|Save Status/ })).toHaveCount(0);
});

test("Payment Collection Renewals uses exactly one metrics and one bounded list request", async ({ page }) => {
  const reads: string[] = [];
  await mockRenewals(page);
  await page.route("**/api/distributors/renewals?**", async (route) => {
    const url = new URL(route.request().url()); reads.push(url.search);
    if (url.searchParams.get("view") === "metrics") return route.fulfill({ json: { enabled: true, metrics: { overdue: 1, today: 2, tomorrow: 3, in_two_days: 4 } } });
    return route.fulfill({ json: { enabled: true, rows: [row], page: 1, page_size: 50, total: 1 } });
  });
  await seed(page, employee, false); await page.goto("/payments/renewals");
  await expect(page.getByRole("heading", { name: "Renewals" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Overdue/ })).toContainText("1");
  await expect(page.getByText("Alpha Distributor")).toBeVisible();
  await expect.poll(() => reads.length).toBe(2);
  expect(reads.filter(query => query.includes("view=metrics"))).toHaveLength(1);
  expect(reads.filter(query => query.includes("view=list") && query.includes("pageSize=50"))).toHaveLength(1);
});

test("renewal urgency cards apply server-side filters without repeating metrics", async ({ page }) => {
  const reads: string[] = []; await mockRenewals(page);
  await page.route("**/api/distributors/renewals?**", async (route) => { const url = new URL(route.request().url()); reads.push(url.search); if (url.searchParams.get("view") === "metrics") return route.fulfill({ json: { enabled: true, metrics: { overdue: 1, today: 2, tomorrow: 3, in_two_days: 4 } } }); return route.fulfill({ json: { enabled: true, rows: [row], page: 1, page_size: 50, total: 1 } }); });
  await seed(page, admin, true); await page.goto("/admin/payments/renewals"); await expect(page.getByText("Alpha Distributor")).toBeVisible();
  await page.getByRole("button", { name: /Tomorrow/ }).click();
  await expect.poll(() => reads.some(query => query.includes("filter=tomorrow"))).toBe(true);
  expect(reads.filter(query => query.includes("view=metrics"))).toHaveLength(1);
});

test("assigned employee renewal edit sends the canonical versioned command", async ({ page }) => {
  await mockRenewals(page); let commandBody = "";
  await page.route("**/api/distributors/commands", async route => { commandBody = route.request().postData() ?? "{}"; await route.fulfill({ json: { success: true, record: { ...row, renewal_date: "2026-09-01", version: 3 } } }); });
  await seed(page, employee, false); await page.goto("/payments/renewals"); await page.getByRole("button", { name: "Set renewal for Alpha Distributor" }).click();
  await page.getByLabel("Next Renewal Date").fill("2026-09-01"); await page.getByRole("button", { name: "Confirm Renewal" }).click();
  const command = JSON.parse(commandBody); expect(command).toMatchObject({ operation_type: "renew", payload: { distributor_id: distributorId, expected_version: 2, renewal_date: "2026-09-01" } });
  expect(Object.keys(command.payload).sort()).toEqual(["distributor_id", "expected_version", "note", "renewal_date"]);
});

test("Renewals distinguishes a server failure from a valid empty result", async ({ page }) => {
  await mockRenewals(page, []); await seed(page, employee, false); await page.goto("/payments/renewals"); await expect(page.getByText("No renewal dates set yet.")).toBeVisible();
  await page.route("**/api/distributors/renewals?**", route => route.fulfill({ status: 503, json: { code: "DISTRIBUTOR_SERVER_ERROR", message: "Renewal read failed." } }));
  await page.reload(); await expect(page.getByText("Unable to load renewals.")).toContainText("Renewal read failed"); await expect(page.getByText("No renewal dates set yet.")).toHaveCount(0);
});

test("Renewals never converts a metrics failure into an empty state", async ({ page }) => {
  await mockRenewals(page, []);
  await page.route("**/api/distributors/renewals?**", route => { const url = new URL(route.request().url()); return url.searchParams.get("view") === "metrics" ? route.fulfill({ status: 503, json: { code: "DISTRIBUTOR_SERVER_ERROR", message: "Metrics failed." } }) : route.fulfill({ json: { enabled: true, rows: [], page: 1, page_size: 50, total: 0 } }); });
  await seed(page, employee, false); await page.goto("/payments/renewals");
  await expect(page.getByText("Unable to load renewal metrics.")).toContainText("Metrics failed");
  await expect(page.getByText("No renewal dates set yet.")).toHaveCount(0);
});
