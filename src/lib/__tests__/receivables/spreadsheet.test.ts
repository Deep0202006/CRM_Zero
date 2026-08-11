import * as XLSX from "xlsx";
import { firstMeaningfulWorksheet } from "@/components/receivables/ReceivablesImportModal";
import { parseReceivablesTable, RECEIVABLE_HEADERS } from "@/lib/receivables/import";

describe("Receivables workbook intake", () => {
  test.each(["xlsx", "xls"] as const)("reads a valid %s workbook from its first meaningful sheet", (bookType) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Cover");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      [...RECEIVABLE_HEADERS],
      ["INV-1", "कंपनी वितरण", "Anita", "", "₹84,500", "11/08/2026", "12-08-2026", "employee@example.test", "", ""],
    ]), "Payment Collections Import");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType });
    const reopened = XLSX.read(bytes, { type: "buffer", cellDates: true });
    const parsed = parseReceivablesTable(firstMeaningfulWorksheet(XLSX, reopened));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ distributorName: "कंपनी वितरण", billAmount: "84500.00", billDueDate: "2026-08-11" });
  });

  test("rejects a workbook with no usable sheet", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["", ""]]), "Empty");
    expect(() => firstMeaningfulWorksheet(XLSX, workbook)).toThrow(/no usable worksheet/i);
  });
});
