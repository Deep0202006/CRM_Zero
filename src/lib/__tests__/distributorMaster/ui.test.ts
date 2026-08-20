import fs from "fs";
import path from "path";
import { DistributorMasterImportModal } from "@/components/distributors/DistributorMasterImportModal";

const modalPath = path.join(process.cwd(), "src/components/distributors/DistributorMasterImportModal.tsx");
const pagePath = path.join(process.cwd(), "src/app/admin/payments/distributors/page.tsx");

describe("distributor master import admin UI", () => {
  const modal = fs.readFileSync(modalPath, "utf8");
  const page = fs.readFileSync(pagePath, "utf8");

  test("exports the admin modal", () => {
    expect(typeof DistributorMasterImportModal).toBe("function");
  });

  test("offers the deterministic template and one bounded XLSX upload", () => {
    expect(modal).toContain("createMasterWorkbook");
    expect(modal).toContain("MASTER_WORKBOOK_FILENAME");
    expect(modal).toContain("Download exact template");
    expect(modal).toContain('accept=".xlsx"');
    expect(modal).toContain("MAX_MASTER_WORKBOOK_BYTES");
    expect(modal).toContain("Choose exact XLSX workbook");
    expect(modal).toContain("selected.name !== MASTER_WORKBOOK_FILENAME");
  });

  test("previews every sheet with the required summary and Before to After table", () => {
    expect(modal).toContain('{ key: "distributors", label: "Distributors" }');
    expect(modal).toContain('{ key: "receivables", label: "Receivables" }');
    expect(modal).toContain('{ key: "payments", label: "Payments" }');
    expect(modal).toContain('["Sheet", "Row", "Distributor", "Bill", "Current State", "Action", "Result State", "Reason"]');
    for (const label of ["New Distributors:", "Distributor Updates:", "No Change:", "New Receivables:", "New Payments:", "Will Become Paid:", "Will Become Partially Paid:", "Will Remain Unpaid:", "Conflicts:", "Invalid Rows:"]) expect(modal).toContain(label);
    expect(modal).toContain("preview.counts.blocking");
    expect(modal).toContain("disabled={preview.blocking}");
    expect(modal).toContain("Safe Changes");
    expect(modal).toContain("Refresh preview");
    expect(modal).toContain("Confirmation is atomic. Either all planned changes commit or none do.");
  });

  test("uses preview-bound safe confirmation and retains a completion summary", () => {
    expect(modal).toContain('form.set("mode", mode)');
    expect(modal).toContain('form.set("operation_id", operationId)');
    expect(modal).toContain('form.set("resolved_plan_hash", preview.resolvedPlanHash)');
    expect(modal).toContain('request("confirm")');
    expect(modal).toContain('aria-label="Master import completion summary"');
    expect(modal).toContain("Master workbook imported successfully.");
    for (const label of ["Distributors created", "Distributors updated", "Renewals updated", "Receivables created", "Payments recorded", "Exact duplicates skipped", "Now Paid", "Now Partially Paid", "Still Unpaid"]) expect(modal).toContain(label);
  });

  test("integrates alongside the existing distributor import and preserves multipart headers", () => {
    expect(page).toContain("<DistributorImportModal");
    expect(page).toContain("<DistributorMasterImportModal");
    expect(page).toContain("Import / Update Master Workbook");
    expect(page).toContain("Invoice Receivables");
    expect(page).toContain("Distributor Import");
    expect(page).toContain("init?.body instanceof FormData");
  });
});
