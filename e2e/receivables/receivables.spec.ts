import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { getCurrentISTDate } from "../../src/lib/dateTime";

const adminId = "10000000-0000-4000-a000-000000000001";
const employeeId = "20000000-0000-4000-a000-000000000001";
const receivableId = "30000000-0000-4000-a000-000000000001";
const distributorId = "40000000-0000-4000-a000-000000000001";
const today = getCurrentISTDate();

function token(userId: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
}

async function seedUser(page: Page, role: "admin" | "employee") {
  const userId = role === "admin" ? adminId : employeeId;
  await page.goto("/login");
  await page.waitForTimeout(300);
  await page.evaluate(async ({ userId, role, accessToken }) => {
    const request = indexedDB.open("CRMDatabase");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["users", "user_capabilities"], "readwrite");
    transaction.objectStore("users").put({ user_id: userId, name: role === "admin" ? "Admin User" : "Employee User", email: `${role}@example.test`, is_active: 1, created_at: new Date().toISOString() });
    if (role === "admin") transaction.objectStore("user_capabilities").put({ id: "cap-admin", user_id: userId, capability_code: "admin", assigned_at: new Date().toISOString() });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    database.close();
    localStorage.setItem("authenticated_user_id", userId);
    localStorage.setItem("sb-e2e-auth-token", JSON.stringify({ access_token: accessToken, refresh_token: "e2e-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: userId, aud: "authenticated", role: "authenticated", email: `${role}@example.test`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
  }, { userId, role, accessToken: token(userId) });
}

function summaryRow(overrides: Record<string, unknown> = {}) {
  return { receivable_id: receivableId, distributor_id: distributorId, bill_reference: "INV-100", distributor_name: "Unicode वितरण", contact_person: "Priya", contact_phone: "9999999999", bill_amount: "1000.00", confirmed_paid_amount: "0.00", outstanding_amount: "1000.00", bill_due_date: "2026-08-01", next_follow_up_date: "2026-08-11", assigned_to: employeeId, owner_name: "Employee User", lifecycle_status: "active", payment_state: "Unpaid", alert_state: "followup_overdue", version: 1, pending_payment_count: 0, aging_bucket: "8-15 days", ...overrides };
}

async function mockBackend(page: Page, role: "admin" | "employee") {
  await page.route("https://e2e.supabase.co/**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/distributors?**", async (route) => route.fulfill({ json: { rows: [{ distributor_id: distributorId, distributor_name: "Acme Distribution", distributor_reference: "ACME-1" }], page: 1, pageSize: 50, total: 1 } }));
  await page.route("**/api/receivables/health", async (route) => route.fulfill({ json: { ready: true } }));
  await page.route("**/api/receivables/admin**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("receivable_id")) return route.fulfill({ json: { receivable: summaryRow(), payments: [], activity: [], history: { payment_count: 0, payment_has_more: false, activity_count: 0, activity_has_more: false } } });
    return route.fulfill({ json: { metrics: { total_outstanding: "1000.00", followups_due_today: 1, overdue_outstanding: "1000.00", collected_this_month: "0.00", total_collected: "400.00", collection_setup_required: 1, awaiting_verification: 0, disputed_outstanding: "0.00", aging: { Current: "0.00", "1-7 days": "0.00", "8-15 days": "1000.00", "16-30 days": "0.00", "31+ days": "0.00" } }, assignees: [{ user_id: employeeId, name: "Employee User", email: "employee@example.test" }], pending: [] } });
  });
  await page.route("**/api/receivables/import", async (route) => {
    const body = route.request().postDataJSON();
    if (body.mode === "preview") return route.fulfill({ json: { rows: body.rows.map((row: object) => ({ ...row, distributor_id: distributorId, resolved_distributor_name: "Acme Distribution", assigned_employee_name: "Employee User", classification: "NEW" })), counts: { new: body.rows.length, exactDuplicate: 0, conflict: 0, invalid: 0 }, preview_hash: "a".repeat(64) } });
    return route.fulfill({ json: { success: true, created_count: body.rows.length, duplicate_count: 0 } });
  });
  await page.route("**/api/receivables/commands", async (route) => route.fulfill({ json: { success: true, receivable: summaryRow() } }));
  await page.route(/\/api\/receivables(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const total = role === "employee" ? 26 : 1;
    const rows = role === "employee" ? Array.from({ length: pageNumber === 1 ? 25 : 1 }, (_, index) => summaryRow({ receivable_id: `30000000-0000-4000-a000-${String((pageNumber - 1) * 25 + index + 1).padStart(12, "0")}` })) : [summaryRow()];
    await route.fulfill({ json: { rows, page: pageNumber, pageSize: role === "employee" ? 25 : 20, total } });
  });
}

test("Admin Payment Collections intake supports manual receivable and spreadsheet preview", async ({ page }) => {
  await mockBackend(page, "admin");
  const commands: Array<Record<string, unknown>> = [];
  await page.unroute("**/api/receivables/commands");
  await page.route("**/api/receivables/commands", async (route) => { commands.push(route.request().postDataJSON()); await route.fulfill({ json: { success: true, receivable: summaryRow() } }); });
  await seedUser(page, "admin");
  await page.goto("/admin/payments");
  await expect(page.getByRole("heading", { name: "Payment Collections", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Receivable" }).click();
  await expect(page.getByRole("dialog", { name: "New Receivable" })).toBeVisible();
  await page.getByLabel("Search Distributor Status").fill("Acme");
  await page.locator('select[name="distributor_id"]').selectOption(distributorId);
  await page.getByLabel("Bill / Invoice Reference").fill("INV-MANUAL-1");
  await page.getByLabel("Contact Person").fill("Anita");
  await page.getByLabel("Bill Amount").fill("₹84,500");
  await page.getByLabel("Bill Due Date").fill("2026-08-01");
  await page.getByLabel("Payment Follow-up Date").fill(today);
  await page.getByLabel("Assigned Employee").selectOption(employeeId);
  await page.getByRole("button", { name: "Create Receivable" }).click();
  await expect(page.getByText("Receivable created and confirmed.")).toBeVisible();
  expect(commands[0]).toMatchObject({ operation_type: "create", payload: { distributor_id: distributorId, distributor_name: "Acme Distribution", distributor_code: "ACME-1" } });
  await page.getByRole("button", { name: "Import Spreadsheet" }).click();
  const templateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Import Template" }).click();
  expect((await templateDownload).suggestedFilename()).toBe("Payment_Collections_Import_Template.xlsx");
  const corruptChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse file" }).click();
  await (await corruptChooser).setFiles({ name: "broken.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("not a workbook") });
  await expect(page.getByText(/corrupt|no usable worksheet|missing required columns|unknown columns/i)).toBeVisible();
  const spreadsheet = { name: "collections.csv", mimeType: "text/csv", buffer: Buffer.from('Bill Reference,Distributor Name,Contact Person,Contact Phone,Bill Amount,Bill Due Date,Payment Follow-up Date,Assigned Employee Email,Distributor Code,Notes\nINV-101,Acme,Anita,,"₹84,500",2026-08-01,2026-08-12,employee@example.test,,\n') };
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse file" }).click();
  await (await chooser).setFiles(spreadsheet);
  await expect(page.getByText("Authoritative preview complete")).toBeVisible();
  await expect(page.getByText("New: 1")).toBeVisible();
  await page.getByRole("button", { name: "Remove selected file" }).click();
  const sameFileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse file" }).click();
  await (await sameFileChooser).setFiles(spreadsheet);
  await expect(page.getByText("Authoritative preview complete")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Import" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirm Import" }).click();
  await expect(page.getByText(/Imported successfully/)).toBeVisible();
  await page.getByText("Unicode वितरण", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Unicode वितरण" })).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("dialog", { name: "Record Payment" })).toBeVisible();
  await page.getByLabel("Amount").fill("400");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("direct payment confirmed.")).toBeVisible();
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("INV-100 %_' SQL");
});

test("Admin intake is visibly disabled when Receivables readiness is false", async ({ page }) => {
  await mockBackend(page, "admin");
  await page.unroute("**/api/receivables/health");
  await page.route("**/api/receivables/health", async (route) => route.fulfill({ json: { ready: false, code: "RECEIVABLES_NOT_ENABLED", message: "Payment Collections is awaiting database activation." } }));
  await seedUser(page, "admin");
  await page.goto("/admin/payments");
  await expect(page.getByText("Payment Collections is awaiting database activation.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Receivable" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Import Spreadsheet" })).toBeDisabled();
});

test("Employee Payment Follow-ups authority surface has actions and Load More without Admin intake", async ({ page }) => {
  await mockBackend(page, "employee");
  await seedUser(page, "employee");
  await page.goto("/payments");
  await expect(page.getByText("Showing 25 of 26 assigned receivables")).toBeVisible();
  await expect(page.getByRole("button", { name: "Payment Reported" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Spreadsheet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Receivable" })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Showing 26 of 26 assigned receivables")).toBeVisible();
});

test("XLSX, XLS, BOM CSV, empty-first-sheet, replacement, and visible file failures work in the browser", async ({ page }) => {
  await mockBackend(page, "admin");
  await seedUser(page, "admin");
  await page.goto("/admin/payments");
  await page.getByRole("button", { name: "Import Spreadsheet" }).click();
  const headers = ["Bill Reference", "Distributor Name", "Contact Person", "Contact Phone", "Bill Amount", "Bill Due Date", "Payment Follow-up Date", "Assigned Employee Email", "Distributor Code", "Notes"];
  const row = ["INV-BROWSER", "\u0935\u093f\u0924\u0930\u0915", "Anita", "", "\u20b984,500", "11/08/2026", "12-08-2026", "employee@example.test", "", ""];
  for (const bookType of ["xlsx", "xls"] as const) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty Cover");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, row]), "Collections");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Browse file" }).click();
    await (await chooser).setFiles({ name: `collections.${bookType}`, mimeType: "application/octet-stream", buffer });
    await expect(page.getByText("Authoritative preview complete")).toBeVisible();
    await page.getByRole("button", { name: "Remove selected file" }).click();
  }
  const bomCsv = Buffer.from(`\uFEFF${headers.join(",")}\nINV-BOM,\u0935\u093f\u0924\u0930\u0915,Anita,,84500,2026-08-11,2026-08-12,employee@example.test,,,`, "utf8");
  const csvChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse file" }).click();
  await (await csvChooser).setFiles({ name: "collections.csv", mimeType: "", buffer: bomCsv });
  await expect(page.getByText("Authoritative preview complete")).toBeVisible();
  await page.getByRole("button", { name: "Remove selected file" }).click();

  const badChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse file" }).click();
  await (await badChooser).setFiles({ name: "collections.txt", mimeType: "text/plain", buffer: Buffer.from("bad") });
  await expect(page.getByText(/Choose an XLSX, XLS, or CSV file/i)).toBeVisible();
  const retryChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Browse file" }).click();
  await (await retryChooser).setFiles({ name: "collections.csv", mimeType: "text/csv", buffer: bomCsv });
  await expect(page.getByText("Authoritative preview complete")).toBeVisible();
});

test("employee forms persist operational intent and terminal rows expose no collection controls", async ({ page }) => {
  await mockBackend(page, "employee");
  await seedUser(page, "employee");
  await page.goto("/payments");
  await page.getByRole("button", { name: "Contacted" }).first().click();
  await page.getByLabel("Next follow-up date").fill(today);
  await page.getByRole("button", { name: "Confirm Contacted" }).click();
  await expect(page.getByText("Collection action confirmed.")).toBeVisible();
  await page.getByRole("button", { name: "Promise to Pay" }).first().click();
  await page.getByLabel("Promise date").fill(today);
  await page.getByLabel("Promised amount").fill("\u20b984,500");
  await page.getByRole("button", { name: "Confirm Promise to Pay" }).click();
  await expect(page.getByText("Collection action confirmed.")).toBeVisible();
  await page.getByRole("button", { name: "Payment Reported" }).first().click();
  await page.getByLabel("Amount").fill("400");
  await page.getByRole("button", { name: "Confirm Payment Reported" }).click();
  await expect(page.getByText("Payment awaiting verification. Confirmed outstanding is unchanged.")).toBeVisible();

  await page.unroute(/\/api\/receivables(?:\?.*)?$/);
  await page.route(/\/api\/receivables(?:\?.*)?$/, async route => route.fulfill({ json: { rows: [summaryRow({ payment_state: "Paid", outstanding_amount: "0.00", next_follow_up_date: null, alert_state: "none" }), summaryRow({ receivable_id: "30000000-0000-4000-a000-000000000002", pending_payment_count: 1, alert_state: "payment_verification_pending" }), summaryRow({ receivable_id: "30000000-0000-4000-a000-000000000003", lifecycle_status: "disputed", payment_state: "Disputed", alert_state: "disputed" }), summaryRow({ receivable_id: "30000000-0000-4000-a000-000000000004", lifecycle_status: "cancelled", payment_state: "Cancelled", alert_state: "none" })], page: 1, pageSize: 25, total: 4 } }));
  await page.reload();
  await expect(page.getByText(/Paid .* no further collection action/i)).toBeVisible();
  await expect(page.getByText(/Payment awaiting verification .* paused/i)).toBeVisible();
  await expect(page.getByText(/Disputed .* paused/i)).toBeVisible();
  await expect(page.getByText(/Cancelled .* closed/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Payment Reported" })).toHaveCount(0);
});

test("critical Admin intake and detail remain usable at mobile and tablet widths", async ({ page }) => {
  await mockBackend(page, "admin");
  await seedUser(page, "admin");
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/payments");
    await page.getByRole("button", { name: "New Receivable" }).click();
    await expect(page.getByRole("dialog", { name: "New Receivable" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByText("Unicode \u0935\u093f\u0924\u0930\u0923", { exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Unicode \u0935\u093f\u0924\u0930\u0923" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record payment" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});
