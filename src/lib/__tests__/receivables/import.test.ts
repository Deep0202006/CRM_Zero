import { MAX_IMPORT_ROWS, parseReceivablesTable } from "@/lib/receivables/import";

const headers = ["Bill Reference", "Distributor Name", "Contact Person", "Bill Amount", "Bill Due Date", "Payment Follow-up Date", "Assigned Employee Email"];
describe("receivables import validation", () => {
  test("accepts canonical Indian values and skips empty rows", () => {
    const result = parseReceivablesTable([headers, ["INV-1", "ABC", "A", "₹84,500", "10/08/2026", "11-08-2026", "a@example.com"], []]);
    expect(result.rows).toHaveLength(1); expect(result.rows[0].billAmount).toBe("84500.00");
  });
  test("rejects duplicate headers, missing fields and ambiguous dates", () => {
    expect(() => parseReceivablesTable([[...headers, "Bill Reference"]])).toThrow(/Duplicate/);
    expect(parseReceivablesTable([headers, ["INV", "ABC", "A", "1", "08/31/2026", "2026-08-11", "a@example.com"]]).invalid).toHaveLength(1);
  });
  test("enforces row cap", () => expect(() => parseReceivablesTable([headers, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => [])])).toThrow(/5,000/));
  test("accepts UTF-8 BOM, Unicode text, and safe Excel date values", () => {
    const result = parseReceivablesTable([
      [`\uFEFF${headers[0]}`, ...headers.slice(1)],
      ["INV-UNICODE", "कंपनी वितरण", "Priya", "84,500.00", 46245, new Date(2026, 7, 12), "employee@example.com"],
    ]);
    expect(result.rows[0]).toMatchObject({ distributorName: "कंपनी वितरण", billDueDate: "2026-08-11", nextFollowUpDate: "2026-08-12" });
  });
  test("rejects unknown columns instead of silently reinterpreting them", () => {
    expect(() => parseReceivablesTable([[...headers, "Unexpected Financial State"]])).toThrow(/Unknown columns/);
  });
});
