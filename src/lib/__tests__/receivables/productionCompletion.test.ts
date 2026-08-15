import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Receivables production completion contracts", () => {
  test("authenticated readiness is observable without exposing configuration", () => {
    const route = read("src/app/api/receivables/health/route.ts");
    expect(route).toContain("contextFor(request)");
    expect(route).toContain("RECEIVABLES_NOT_ENABLED");
    expect(route).toContain("RECEIVABLES_SCHEMA_UNAVAILABLE");
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  test("Admin intake is modal-based, explicit, and readiness gated", () => {
    const page = read("src/app/admin/payments/page.tsx");
    expect(page).toContain("New Receivable");
    expect(page).toContain("Import Spreadsheet");
    expect(page).toContain("ReceivablesCreateModal");
    expect(page).toContain("ReceivablesImportModal");
    expect(page).toContain("/api/receivables/health");
    expect(page).not.toContain("<h2 className=\"section-title\">Manual entry</h2>");
  });

  test("spreadsheet workspace supports recovery and a documented template", () => {
    const workspace = read("src/components/receivables/ReceivablesImportModal.tsx");
    expect(workspace).toContain("Download Import Template");
    expect(workspace).toContain("drag and drop");
    expect(workspace).toContain("inputRef.current.value = \"\"");
    expect(workspace).toContain("firstMeaningfulWorksheet");
    expect(workspace).toContain("Payment Collections Import");
    expect(workspace).toContain("Instructions");
  });

  test("critical Admin and employee browser flows are represented", () => {
    const spec = read("e2e/receivables/receivables.spec.ts");
    expect(spec).toContain("Admin Payment Collections intake");
    expect(spec).toContain("Employee Payment Follow-ups authority surface");
    expect(spec).toContain("manual receivable");
    expect(spec).toContain("spreadsheet preview");
    expect(spec).toContain("Load More");
  });

  test("Admin assignment is server-listed and database-enforced as terminal", () => {
    const adminRoute = read("src/app/api/receivables/admin/route.ts");
    const commandRoute = read("src/app/api/receivables/commands/route.ts");
    const importRoute = read("src/app/api/receivables/import/route.ts");
    const migration = read("supabase/migrations/034_receivables_production_completion.sql");
    expect(adminRoute).toContain("assignees");
    expect(adminRoute).toContain("listEligibleOperationalEmployees");
    expect(read("src/lib/employees/server.ts")).toContain('capability_code", "admin');
    expect(read("src/lib/employees/server.ts")).toContain("MAX_OPERATIONAL_EMPLOYEES");
    expect(commandRoute).toContain('error.code==="ZD001"');
    expect(commandRoute).toContain("INVALID_ASSIGNEE");
    expect(importRoute).toContain("IMPORT_EMPLOYEE_CHANGED");
    expect(migration).toContain("receivables_operational_assignee_guard_v1");
  });

  test("employee collections refresh on meaningful browser events without polling", () => {
    const page = read("src/app/payments/page.tsx");
    expect(page).not.toContain("setInterval");
    expect(page).toContain('window.addEventListener("online",refresh)');
    expect(page).toContain('document.addEventListener("visibilitychange",visible)');
  });

  test("optional Distributor and renewal failures remain visible without suppressing money authority", () => {
    expect(read("src/app/api/receivables/admin/route.ts")).toContain("distributor_status_error");
    expect(read("src/app/api/receivables/admin/route.ts")).toContain("identityResult.error");
    expect(read("src/lib/distributors/server.ts")).toContain("PGRST205");
    expect(read("src/app/admin/payments/page.tsx")).toContain("Financial detail is unaffected.");
    expect(read("src/app/api/my-day/receivables/route.ts")).toContain("renewals_error");
    expect(read("src/components/PaymentCollectionsPriorityPanel.tsx")).toContain("Payment Collection data remains authoritative.");
  });
});
