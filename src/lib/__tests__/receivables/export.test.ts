import * as XLSX from "xlsx";
import { collectBoundedExportRows, ExportTooLargeError, receivablesExportFilename, spreadsheetSafeText, toReceivableExportRow } from "@/lib/receivables/export";

describe("Receivables financial export", () => {
  test.each(["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "  =HYPERLINK(\"https://bad\")"])("neutralizes formula-capable text %s", input => {
    expect(spreadsheetSafeText(input)).toBe(`'${input}`);
  });

  test("preserves ordinary and Unicode text", () => {
    expect(spreadsheetSafeText("Shri \u0935\u093f\u0924\u0930\u0915")).toBe("Shri \u0935\u093f\u0924\u0930\u0915");
  });

  test("writes neutralized user fields and the required Contact column into XLSX", () => {
    const exported = toReceivableExportRow({ distributor_name: "=WEBSERVICE(\"https://bad\")", contact_person: "+cmd", bill_reference: "@REF", bill_amount: "1000.00", confirmed_paid_amount: "0.00", outstanding_amount: "1000.00", bill_due_date: "2026-08-10", next_follow_up_date: "2026-08-12", payment_state: "Unpaid", lifecycle_status: "active", aging_bucket: "1-7 days", created_at: "2026-08-11T00:00:00Z" }, "-Owner");
    const sheet = XLSX.utils.json_to_sheet([exported]);
    const decoded = XLSX.utils.sheet_to_json<Record<string, string>>(sheet)[0];
    expect(decoded.Distributor).toBe("'=WEBSERVICE(\"https://bad\")");
    expect(decoded.Contact).toBe("'+cmd");
    expect(decoded["Bill Ref"]).toBe("'@REF");
    expect(decoded.Owner).toBe("'-Owner");
  });

  test("uses the IST business date in the filename at the UTC boundary", () => {
    expect(receivablesExportFilename(new Date("2026-08-10T18:31:00.000Z"))).toBe("Payment_Collections_2026-08-11.xlsx");
  });

  test.each([0, 1, 9999, 10000])("permits a bounded export of %i rows", async total => {
    const rows = await collectBoundedExportRows(async (from, to) => Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, index) => from + index));
    expect(rows).toHaveLength(total);
    expect(new Set(rows).size).toBe(total);
  });

  test("rejects row 10,001 instead of silently truncating", async () => {
    await expect(collectBoundedExportRows(async (from, to) => Array.from({ length: Math.max(0, Math.min(to + 1, 10001) - from) }, (_, index) => from + index))).rejects.toBeInstanceOf(ExportTooLargeError);
  });
});
