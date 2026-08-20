import * as XLSX from "xlsx";
import {
  createMasterWorkbook,
  DISTRIBUTOR_HEADERS,
  MASTER_WORKBOOK_FILENAME,
  MASTER_WORKBOOK_FORMAT,
  parseMasterWorkbook,
  PAYMENT_HEADERS,
  readMasterWorkbook,
  RECEIVABLE_HEADERS,
} from "@/lib/distributorMaster";

function completeWorkbook() {
  const workbook = createMasterWorkbook();
  workbook.Sheets.Distributors = XLSX.utils.aoa_to_sheet([
    [...DISTRIBUTOR_HEADERS],
    [
      " dist-001 ",
      " MARG ",
      "  Example   Distributor ",
      "OWNER@EXAMPLE.COM",
      "DONE",
      "20/08/2026",
      "done",
      "2026-08-21",
      "done",
      "22-08-2026",
      "Active",
      "not billed",
      "",
      "",
      "2027-08-20",
      "+91 90000 00000",
      " Pune ",
      "Imported account",
    ],
  ]);
  workbook.Sheets.Receivables = XLSX.utils.aoa_to_sheet([
    [...RECEIVABLE_HEADERS],
    [
      "dist-001",
      "INV-001",
      "Customer",
      "+91 90000 00000",
      "₹84,500",
      "2026-09-01",
      "02/09/2026",
      "First bill",
    ],
  ]);
  workbook.Sheets.Payments = XLSX.utils.aoa_to_sheet([
    [...PAYMENT_HEADERS],
    [
      "dist-001",
      "INV-001",
      "legacy-ledger-42",
      "4500.5",
      "19-08-2026",
      "Bank Transfer",
      "UTR-42",
      "Historical receipt",
    ],
  ]);
  return workbook;
}

describe("distributor master workbook V2", () => {
  test("template has deterministic format marker, sheet order, and canonical headers", () => {
    const workbook = createMasterWorkbook();
    expect(MASTER_WORKBOOK_FILENAME).toBe(
      "ZeroData_Distributor_Master_Import.xlsx",
    );
    expect(workbook.SheetNames).toEqual([
      "Distributors",
      "Receivables",
      "Payments",
      "Instructions",
    ]);
    expect(DISTRIBUTOR_HEADERS).toEqual([
      "Distributor Reference",
      "ERP",
      "Distributor Name",
      "Assigned Employee Email",
      "Installation Status",
      "Installation Date",
      "Training Status",
      "Training Date",
      "Mapping Status",
      "Mapped Date",
      "Activity Status",
      "Billing Status",
      "Bill Date",
      "Operational Bill Reference",
      "Renewal Date",
      "Phone",
      "City",
      "Notes",
    ]);
    expect(RECEIVABLE_HEADERS).toEqual([
      "Distributor Reference",
      "Bill Reference",
      "Contact Person",
      "Contact Phone",
      "Bill Amount",
      "Bill Due Date",
      "Payment Follow-up Date",
      "Notes",
    ]);
    expect(PAYMENT_HEADERS).toEqual([
      "Distributor Reference",
      "Bill Reference",
      "Payment Import Key",
      "Payment Amount",
      "Payment Date",
      "Payment Mode",
      "Payment Reference",
      "Notes",
    ]);
    expect(workbook.Sheets.Instructions.A1.v).toBe(MASTER_WORKBOOK_FORMAT);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets.Distributors, { header: 1 })[0],
    ).toEqual([...DISTRIBUTOR_HEADERS]);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets.Receivables, { header: 1 })[0],
    ).toEqual([...RECEIVABLE_HEADERS]);
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets.Payments, { header: 1 })[0],
    ).toEqual([...PAYMENT_HEADERS]);
    const instructions = XLSX.utils.sheet_to_json(
      workbook.Sheets.Instructions,
      { header: 1 },
    ) as string[][];
    expect(instructions.flat().join(" ")).toMatch(
      /Example Distributor.*Example Receivable.*Example Payment/i,
    );
    expect(instructions.flat().join(" ")).toMatch(
      /Formula cells.*rejected.*literal values/i,
    );
  });

  test("normalizes whitespace, email, statuses, dates, and decimal money deterministically", () => {
    const workbook = completeWorkbook();
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const parsed = parseMasterWorkbook(
      XLSX.read(bytes, { type: "buffer", cellDates: true }),
      bytes.length,
    );
    expect(parsed.totalRows).toBe(3);
    expect(parsed.distributors[0]).toMatchObject({
      distributorReference: "dist-001",
      erpName: "MARG",
      distributorName: "Example Distributor",
      assignedEmployeeEmail: "owner@example.com",
      installationStatus: "done",
      installationDate: "2026-08-20",
      activityStatus: "active",
      billingStatus: "not_billed",
      phone: "+91 90000 00000",
      city: "Pune",
      notes: "Imported account",
    });
    expect(parsed.receivables[0]).toMatchObject({
      billAmount: "84500.00",
      billDueDate: "2026-09-01",
      nextFollowUpDate: "2026-09-02",
    });
    expect(parsed.payments[0]).toMatchObject({
      paymentAmount: "4500.50",
      paymentDate: "2026-08-19",
      paymentImportKey: "legacy-ledger-42",
    });
  });

  test("requires the exact versioned sheet set and format marker", () => {
    const workbook = completeWorkbook();
    workbook.SheetNames.push("Extra");
    workbook.Sheets.Extra = XLSX.utils.aoa_to_sheet([["x"]]);
    expect(() => parseMasterWorkbook(workbook, 1)).toThrow(
      /sheets must be exactly/i,
    );
    const template = completeWorkbook();
    template.Sheets.Instructions.A1.v = "OLD_FORMAT";
    expect(() => parseMasterWorkbook(template, 1)).toThrow(/Instructions!A1/i);
    const reordered = completeWorkbook();
    reordered.SheetNames = [
      "Instructions",
      "Distributors",
      "Receivables",
      "Payments",
    ];
    expect(() => parseMasterWorkbook(reordered, 1)).toThrow(
      /sheets must be exactly/i,
    );
  });

  test("rejects the V1 Distributor sheet with an explicit template upgrade error", () => {
    const workbook = completeWorkbook();
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Distributors, {
      header: 1,
    }) as unknown[][];
    workbook.Sheets.Distributors = XLSX.utils.aoa_to_sheet(
      rows.map((row) => row.filter((_value, index) => index !== 1)),
    );
    expect(() => parseMasterWorkbook(workbook, 1)).toThrow(
      /CRM_DISTRIBUTOR_MASTER_V1.*Download Latest Template/i,
    );
  });

  test("rejects header drift, formulas, invalid row state, and byte overflow", () => {
    const drifted = completeWorkbook();
    drifted.Sheets.Payments.A1.v = "Distributor";
    expect(() => parseMasterWorkbook(drifted, 1)).toThrow(
      /headers must exactly match/i,
    );
    const duplicate = completeWorkbook();
    duplicate.Sheets.Payments.B1.v = "Distributor Reference";
    expect(() => parseMasterWorkbook(duplicate, 1)).toThrow(
      /duplicate headers/i,
    );
    const formula = completeWorkbook();
    formula.Sheets.Payments.H2 = { t: "s", v: "unsafe", f: "1+1" };
    expect(() => parseMasterWorkbook(formula, 1)).toThrow(/formulas/i);
    const illegalClear = completeWorkbook();
    illegalClear.Sheets.Distributors.C2.v = "[CLEAR]";
    expect(() => parseMasterWorkbook(illegalClear, 1)).toThrow(
      /Distributor Name cannot be cleared/i,
    );
    expect(() =>
      parseMasterWorkbook(completeWorkbook(), 10 * 1024 * 1024 + 1),
    ).toThrow(/10 MB/i);
  });

  test("permits header-only domain sheets but not a completely data-free workbook", () => {
    const workbook = createMasterWorkbook();
    workbook.Sheets.Payments = XLSX.utils.aoa_to_sheet([
      [...PAYMENT_HEADERS],
      ["dist-1", "INV-1", "key-1", "1", "2026-08-20", "", "", ""],
    ]);
    expect(parseMasterWorkbook(workbook, 1).totalRows).toBe(1);
    expect(() => parseMasterWorkbook(createMasterWorkbook(), 1)).toThrow(
      /no data rows/i,
    );
  });

  test("reads only XLSX bytes and enforces the whole-workbook row budget", () => {
    const valid = completeWorkbook();
    const bytes = XLSX.write(valid, { type: "buffer", bookType: "xlsx" });
    expect(readMasterWorkbook(bytes, MASTER_WORKBOOK_FILENAME).totalRows).toBe(
      3,
    );
    expect(() => readMasterWorkbook(bytes, "renamed.xlsx")).toThrow(
      /ZeroData_Distributor_Master_Import\.xlsx/i,
    );
    expect(() => readMasterWorkbook(bytes, "master.xls")).toThrow(
      /ZeroData_Distributor_Master_Import\.xlsx/i,
    );

    const workbook = createMasterWorkbook();
    workbook.Sheets.Receivables = XLSX.utils.aoa_to_sheet([
      [...RECEIVABLE_HEADERS],
      ...Array.from({ length: 2_500 }, (_, index) => [
        "dist-1",
        `INV-${index}`,
        "Customer",
        "",
        "1",
        "2026-09-01",
        "2026-09-02",
        "",
      ]),
    ]);
    workbook.Sheets.Payments = XLSX.utils.aoa_to_sheet([
      [...PAYMENT_HEADERS],
      ...Array.from({ length: 2_501 }, (_, index) => [
        "dist-1",
        `INV-${index}`,
        `KEY-${index}`,
        "1",
        "2026-08-20",
        "",
        "",
        "",
      ]),
    ]);
    expect(() => parseMasterWorkbook(workbook, 1)).toThrow(
      /5,000 total data rows/i,
    );
  });
});
