import * as XLSX from "xlsx";
import {
  minorUnitsToDecimal,
  parseMoneyToMinorUnits,
} from "@/lib/receivables/domain";

export const MASTER_WORKBOOK_FORMAT = "CRM_DISTRIBUTOR_MASTER_V2" as const;
export const MASTER_WORKBOOK_FILENAME =
  "ZeroData_Distributor_Master_Import.xlsx";
export const MASTER_CLEAR_TOKEN = "[CLEAR]" as const;
export const MAX_MASTER_WORKBOOK_BYTES = 10 * 1024 * 1024;
export const MAX_MASTER_SHEET_ROWS = 5_000;
export const MAX_MASTER_TOTAL_ROWS = 5_000;

export const MASTER_SHEETS = [
  "Distributors",
  "Receivables",
  "Payments",
  "Instructions",
] as const;
export const DISTRIBUTOR_HEADERS = [
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
] as const;
export const RECEIVABLE_HEADERS = [
  "Distributor Reference",
  "Bill Reference",
  "Contact Person",
  "Contact Phone",
  "Bill Amount",
  "Bill Due Date",
  "Payment Follow-up Date",
  "Notes",
] as const;
export const PAYMENT_HEADERS = [
  "Distributor Reference",
  "Bill Reference",
  "Payment Import Key",
  "Payment Amount",
  "Payment Date",
  "Payment Mode",
  "Payment Reference",
  "Notes",
] as const;

type Cell = string | number | boolean | Date | null | undefined;
type Table = Cell[][];

export interface MasterDistributorRow {
  rowNumber: number;
  distributorReference: string;
  erpName?: string;
  distributorName: string;
  assignedEmployeeEmail: string;
  installationStatus: "pending" | "done" | "";
  installationDate: string;
  trainingStatus: "pending" | "done" | "";
  trainingDate: string;
  mappingStatus: "pending" | "done" | "";
  mappedDate: string;
  activityStatus: "not_applicable" | "active" | "inactive" | "";
  billingStatus: "not_billed" | "billed" | "";
  billDate: string;
  operationalBillReference: string;
  renewalDate: string;
  phone?: string;
  city?: string;
  notes?: string;
}

export class MasterTemplateOutdatedError extends Error {
  readonly code = "MASTER_TEMPLATE_OUTDATED";
  constructor() {
    super(
      "This is a CRM_DISTRIBUTOR_MASTER_V1 workbook. Download Latest Template and use the V2 ERP format.",
    );
  }
}

export interface MasterReceivableRow {
  rowNumber: number;
  distributorReference: string;
  billReference: string;
  contactPerson: string;
  contactPhone: string;
  billAmount: string;
  billDueDate: string;
  nextFollowUpDate: string;
  notes: string;
}

export interface MasterPaymentRow {
  rowNumber: number;
  distributorReference: string;
  billReference: string;
  paymentImportKey: string;
  paymentAmount: string;
  paymentDate: string;
  paymentMode: string;
  paymentReference: string;
  notes: string;
}

export interface ParsedMasterWorkbook {
  format: typeof MASTER_WORKBOOK_FORMAT;
  distributors: MasterDistributorRow[];
  receivables: MasterReceivableRow[];
  payments: MasterPaymentRow[];
  totalRows: number;
}

function text(value: Cell): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedHeader(value: Cell): string {
  return text(value)
    .toLocaleLowerCase("en-IN")
    .replace(/[\s_-]+/g, " ");
}

function requiredText(value: Cell, label: string, maximum = 160): string {
  const result = text(value);
  if (!result) throw new Error(`Missing required value: ${label}.`);
  if (result.length > maximum)
    throw new Error(`${label} must be at most ${maximum} characters.`);
  return result;
}

function optionalText(value: Cell, label: string, maximum: number): string {
  const result = text(value);
  if (result.length > maximum)
    throw new Error(`${label} must be at most ${maximum} characters.`);
  return result;
}

function patchText(
  value: Cell,
  label: string,
  maximum: number,
  clearable = false,
): string {
  const result = optionalText(value, label, maximum);
  if (result.toLocaleUpperCase("en-IN") !== MASTER_CLEAR_TOKEN) return result;
  if (!clearable) throw new Error(`${label} cannot be cleared.`);
  return MASTER_CLEAR_TOKEN;
}

function distributorReference(value: Cell): string {
  const result = requiredText(value, "Distributor Reference", 80);
  if (result.toLocaleUpperCase("en-IN") === MASTER_CLEAR_TOKEN)
    throw new Error("Distributor Reference cannot be cleared.");
  return result;
}

function patchEmail(value: Cell): string {
  const result = patchText(value, "Assigned Employee Email", 254);
  if (!result) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw new Error("Assigned Employee Email is invalid.");
  return result.toLocaleLowerCase("en-IN");
}

function date(value: Cell, label: string, optional = false): string {
  if (optional && text(value) === "") return "";
  let year: number, month: number, day: number;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getUTCFullYear();
    month = value.getUTCMonth() + 1;
    day = value.getUTCDate();
  } else if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
  ) {
    const result = new Date(Date.UTC(1899, 11, 30 + value));
    year = result.getUTCFullYear();
    month = result.getUTCMonth() + 1;
    day = result.getUTCDate();
  } else {
    const valueText = text(value);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valueText);
    const indian = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(valueText);
    if (!iso && !indian)
      throw new Error(
        `${label} must use YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY.`,
      );
    year = Number(iso?.[1] ?? indian?.[3]);
    month = Number(iso?.[2] ?? indian?.[2]);
    day = Number(iso?.[3] ?? indian?.[1]);
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a valid calendar date.`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function patchDate(value: Cell, label: string): string {
  const result = text(value);
  if (!result) return "";
  if (result.toLocaleUpperCase("en-IN") === MASTER_CLEAR_TOKEN)
    return MASTER_CLEAR_TOKEN;
  return date(value, label);
}

function status<T extends string>(
  value: Cell,
  label: string,
  allowed: readonly T[],
): T {
  const result = requiredText(value, label)
    .toLocaleLowerCase("en-IN")
    .replace(/[\s-]+/g, "_");
  if (!allowed.includes(result as T))
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  return result as T;
}

function patchStatus<T extends string>(
  value: Cell,
  label: string,
  allowed: readonly T[],
): T | "" {
  if (!text(value)) return "";
  if (text(value).toLocaleUpperCase("en-IN") === MASTER_CLEAR_TOKEN)
    throw new Error(`${label} cannot be cleared.`);
  return status(value, label, allowed);
}

function money(value: Cell): string {
  const normalized =
    typeof value === "string"
      ? value.normalize("NFKC").trim().replace(/^₹\s?/, "")
      : value;
  return minorUnitsToDecimal(
    parseMoneyToMinorUnits(normalized as string | number),
  );
}

function assertUnique<T extends { rowNumber: number }>(
  rows: T[],
  key: (row: T) => string,
  label: string,
): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const identity = key(row).toLocaleLowerCase("en-IN");
    const earlier = seen.get(identity);
    if (earlier !== undefined)
      throw new Error(
        `${label} is repeated at rows ${earlier} and ${row.rowNumber}.`,
      );
    seen.set(identity, row.rowNumber);
  }
}

function tableReader<const H extends readonly string[]>(
  sheetName: string,
  table: Table,
  headers: H,
) {
  if (
    !table.length ||
    table.every((row) => row.every((value) => text(value) === ""))
  ) {
    throw new Error(
      `${sheetName} sheet is empty; keep its canonical header row even when it has no data.`,
    );
  }
  const labels = table[0].map(normalizedHeader);
  if (labels.some((label) => !label))
    throw new Error(`${sheetName} has a blank header.`);
  if (new Set(labels).size !== labels.length)
    throw new Error(`${sheetName} has duplicate headers.`);
  const expected = headers.map(normalizedHeader);
  const unknown = labels.filter((label) => !expected.includes(label));
  const missing = expected.filter((label) => !labels.includes(label));
  if (
    sheetName === "Distributors" &&
    missing.length === 1 &&
    missing[0] === normalizedHeader("ERP") &&
    labels.length === expected.length - 1
  ) {
    throw new MasterTemplateOutdatedError();
  }
  if (unknown.length || missing.length || labels.length !== expected.length) {
    throw new Error(`${sheetName} headers must exactly match the V2 template.`);
  }
  const data = table
    .slice(1)
    .filter((row) => row.some((value) => text(value) !== ""));
  if (data.length > MAX_MASTER_SHEET_ROWS)
    throw new Error(`${sheetName} exceeds the 5,000-row sheet limit.`);
  const positions = new Map(
    headers.map((header) => [header, labels.indexOf(normalizedHeader(header))]),
  );
  return {
    data,
    value: (row: Cell[], header: H[number]) => row[positions.get(header) ?? -1],
  };
}

function parseDistributors(table: Table): MasterDistributorRow[] {
  const reader = tableReader("Distributors", table, DISTRIBUTOR_HEADERS);
  return reader.data.map((row, offset) => {
    try {
      const result: MasterDistributorRow = {
        rowNumber: offset + 2,
        distributorReference: distributorReference(
          reader.value(row, "Distributor Reference"),
        ),
        erpName: patchText(reader.value(row, "ERP"), "ERP", 160, true),
        distributorName: patchText(
          reader.value(row, "Distributor Name"),
          "Distributor Name",
          200,
        ),
        assignedEmployeeEmail: patchEmail(
          reader.value(row, "Assigned Employee Email"),
        ),
        installationStatus: patchStatus(
          reader.value(row, "Installation Status"),
          "Installation Status",
          ["pending", "done"],
        ),
        installationDate: patchDate(
          reader.value(row, "Installation Date"),
          "Installation Date",
        ),
        trainingStatus: patchStatus(
          reader.value(row, "Training Status"),
          "Training Status",
          ["pending", "done"],
        ),
        trainingDate: patchDate(
          reader.value(row, "Training Date"),
          "Training Date",
        ),
        mappingStatus: patchStatus(
          reader.value(row, "Mapping Status"),
          "Mapping Status",
          ["pending", "done"],
        ),
        mappedDate: patchDate(reader.value(row, "Mapped Date"), "Mapped Date"),
        activityStatus: patchStatus(
          reader.value(row, "Activity Status"),
          "Activity Status",
          ["not_applicable", "active", "inactive"],
        ),
        billingStatus: patchStatus(
          reader.value(row, "Billing Status"),
          "Billing Status",
          ["not_billed", "billed"],
        ),
        billDate: patchDate(reader.value(row, "Bill Date"), "Bill Date"),
        operationalBillReference: patchText(
          reader.value(row, "Operational Bill Reference"),
          "Operational Bill Reference",
          160,
          true,
        ),
        renewalDate: patchDate(
          reader.value(row, "Renewal Date"),
          "Renewal Date",
        ),
        phone: patchText(reader.value(row, "Phone"), "Phone", 40, true),
        city: patchText(reader.value(row, "City"), "City", 120, true),
        notes: patchText(reader.value(row, "Notes"), "Notes", 1_000),
      };
      return result;
    } catch (cause) {
      throw new Error(
        `Distributors row ${offset + 2}: ${cause instanceof Error ? cause.message : "Invalid row."}`,
      );
    }
  });
}

function parseReceivables(table: Table): MasterReceivableRow[] {
  const reader = tableReader("Receivables", table, RECEIVABLE_HEADERS);
  return reader.data.map((row, offset) => {
    try {
      return {
        rowNumber: offset + 2,
        distributorReference: requiredText(
          reader.value(row, "Distributor Reference"),
          "Distributor Reference",
          80,
        ),
        billReference: requiredText(
          reader.value(row, "Bill Reference"),
          "Bill Reference",
          160,
        ),
        contactPerson: requiredText(
          reader.value(row, "Contact Person"),
          "Contact Person",
          160,
        ),
        contactPhone: optionalText(
          reader.value(row, "Contact Phone"),
          "Contact Phone",
          40,
        ),
        billAmount: money(reader.value(row, "Bill Amount")),
        billDueDate: date(reader.value(row, "Bill Due Date"), "Bill Due Date"),
        nextFollowUpDate: date(
          reader.value(row, "Payment Follow-up Date"),
          "Payment Follow-up Date",
          true,
        ),
        notes: optionalText(reader.value(row, "Notes"), "Notes", 1_000),
      };
    } catch (cause) {
      throw new Error(
        `Receivables row ${offset + 2}: ${cause instanceof Error ? cause.message : "Invalid row."}`,
      );
    }
  });
}

function parsePayments(table: Table): MasterPaymentRow[] {
  const reader = tableReader("Payments", table, PAYMENT_HEADERS);
  return reader.data.map((row, offset) => {
    try {
      return {
        rowNumber: offset + 2,
        distributorReference: requiredText(
          reader.value(row, "Distributor Reference"),
          "Distributor Reference",
          80,
        ),
        billReference: requiredText(
          reader.value(row, "Bill Reference"),
          "Bill Reference",
          160,
        ),
        paymentImportKey: requiredText(
          reader.value(row, "Payment Import Key"),
          "Payment Import Key",
          160,
        ),
        paymentAmount: money(reader.value(row, "Payment Amount")),
        paymentDate: date(reader.value(row, "Payment Date"), "Payment Date"),
        paymentMode: optionalText(
          reader.value(row, "Payment Mode"),
          "Payment Mode",
          60,
        ),
        paymentReference: optionalText(
          reader.value(row, "Payment Reference"),
          "Payment Reference",
          160,
        ),
        notes: optionalText(reader.value(row, "Notes"), "Notes", 1_000),
      };
    } catch (cause) {
      throw new Error(
        `Payments row ${offset + 2}: ${cause instanceof Error ? cause.message : "Invalid row."}`,
      );
    }
  });
}

function worksheetTable(workbook: XLSX.WorkBook, name: string): Table {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Missing required sheet: ${name}.`);
  for (const cell of Object.values(sheet)) {
    if (cell && typeof cell === "object" && "f" in cell && cell.f)
      throw new Error(`${name} contains formulas; paste values only.`);
  }
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as Table;
}

export function parseMasterWorkbook(
  workbook: XLSX.WorkBook,
  byteLength: number,
): ParsedMasterWorkbook {
  if (byteLength <= 0) throw new Error("The workbook is empty.");
  if (byteLength > MAX_MASTER_WORKBOOK_BYTES)
    throw new Error("Maximum workbook size is 10 MB.");
  if (
    workbook.SheetNames.length !== MASTER_SHEETS.length ||
    workbook.SheetNames.some((name, index) => name !== MASTER_SHEETS[index])
  ) {
    throw new Error(
      `Workbook sheets must be exactly: ${MASTER_SHEETS.join(", ")}.`,
    );
  }
  if (workbook.Workbook?.Sheets?.some((sheet) => sheet.Hidden))
    throw new Error("Workbook sheets must not be hidden.");
  const instructions = worksheetTable(workbook, "Instructions");
  if (text(instructions[0]?.[0]) !== MASTER_WORKBOOK_FORMAT)
    throw new Error(`Instructions!A1 must be ${MASTER_WORKBOOK_FORMAT}.`);
  const distributors = parseDistributors(
    worksheetTable(workbook, "Distributors"),
  );
  const receivables = parseReceivables(worksheetTable(workbook, "Receivables"));
  const payments = parsePayments(worksheetTable(workbook, "Payments"));
  assertUnique(
    distributors,
    (row) => row.distributorReference,
    "Distributor Reference in Distributors",
  );
  assertUnique(
    receivables,
    (row) => `${row.distributorReference}\u0000${row.billReference}`,
    "Receivable identity",
  );
  assertUnique(
    payments,
    (row) =>
      `${row.distributorReference}\u0000${row.billReference}\u0000${row.paymentImportKey}`,
    "Payment identity",
  );
  const totalRows = distributors.length + receivables.length + payments.length;
  if (totalRows === 0) throw new Error("The workbook contains no data rows.");
  if (totalRows > MAX_MASTER_TOTAL_ROWS)
    throw new Error("Maximum 5,000 total data rows allowed across all sheets.");
  return {
    format: MASTER_WORKBOOK_FORMAT,
    distributors,
    receivables,
    payments,
    totalRows,
  };
}

export function readMasterWorkbook(
  bytes: ArrayBuffer | Uint8Array,
  filename: string,
): ParsedMasterWorkbook {
  if (filename.trim() !== MASTER_WORKBOOK_FILENAME)
    throw new Error(`Choose ${MASTER_WORKBOOK_FILENAME}.`);
  const byteLength = bytes.byteLength;
  if (byteLength <= 0) throw new Error("The workbook is empty.");
  if (byteLength > MAX_MASTER_WORKBOOK_BYTES)
    throw new Error("Maximum workbook size is 10 MB.");
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      codepage: 65001,
    });
  } catch {
    throw new Error(
      "The workbook is corrupt, password-protected, or unsupported.",
    );
  }
  return parseMasterWorkbook(workbook, byteLength);
}

export function createMasterWorkbook(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const instructions = [
    [MASTER_WORKBOOK_FORMAT],
    ["Filename", MASTER_WORKBOOK_FILENAME],
    [
      "Sheets",
      "Keep this exact order: Distributors, Receivables, Payments, Instructions.",
    ],
    [
      "Headers",
      "Use the supplied headers once each. Unknown, missing, blank, or duplicate headers reject the workbook.",
    ],
    [
      "Limits",
      "XLSX only; 10 MB; 5,000 rows per data sheet and 5,000 data rows total.",
    ],
    [
      "Business rows",
      "Enter at least one row across Distributors, Receivables, or Payments. Header-only domain sheets are allowed.",
    ],
    [
      "Formula safety",
      "Formula cells anywhere in the workbook are rejected. Paste literal values only; do not enter values beginning with = as formulas.",
    ],
    [
      "Identity",
      "Distributor Reference is required and is the stable cross-sheet distributor key.",
    ],
    [
      "Distributor updates",
      "For an existing Distributor, blank cells including ERP mean NO_CHANGE. Names are never used to find an account.",
    ],
    [
      "Clear values",
      "Use [CLEAR] only for ERP, nullable Distributor dates, Operational Bill Reference, Renewal Date, Phone, or City.",
    ],
    [
      "New Distributors",
      "Provide ERP, name, eligible employee email, every lifecycle status, and each date required by a done/billed status.",
    ],
    [
      "Receivables",
      "Distributor Reference + Bill Reference identifies one exact bill obligation; assignment comes from the post-import Distributor.",
    ],
    [
      "Receivable follow-up",
      "Payment Follow-up Date may be blank only when all planned Payments leave the bill fully paid.",
    ],
    [
      "Payments",
      "Payment Import Key must be stable and unique for that exact receivable. Payments are historical confirmed events.",
    ],
    [
      "Dates",
      "Use YYYY-MM-DD (DD/MM/YYYY and DD-MM-YYYY are accepted and normalized).",
    ],
    [
      "Money",
      "Positive decimal amount with at most two decimal places; commas and the rupee prefix are accepted.",
    ],
    [
      "Empty sheets",
      "Keep every data sheet and its header row even when that domain has no rows.",
    ],
    [
      "Example Distributor",
      "ZD-MUM-001 | MARG | Mumbai Central Distributor | owner@example.com | done | 2026-08-01 | done | 2026-08-02 | done | 2026-08-03 | active | billed | 2026-08-04 | OPS-2026-001 | 2027-08-04 | +91 98765 43210 | Mumbai | New Distributor only",
    ],
    [
      "Example Renewal Update",
      "ZD-MUM-001 | (blank) | (blank) | ... | Renewal Date 2028-08-04; every other blank cell is NO_CHANGE",
    ],
    [
      "Example Clear",
      "Use [CLEAR] in Renewal Date, Phone, City, Operational Bill Reference, or an optional lifecycle date only when the resulting state is legal.",
    ],
    [
      "Example Receivable",
      "ZD-MUM-001 | INV-2026-001 | Priya Shah | +91 98765 43210 | 84500.00 | 2026-09-01 | 2026-08-25 | Annual platform fee",
    ],
    [
      "Example Payment",
      "ZD-MUM-001 | INV-2026-001 | ERP-RCPT-0042 | 4500.50 | 2026-08-19 | Bank Transfer | UTR-0042 | Historical confirmed receipt",
    ],
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[...DISTRIBUTOR_HEADERS]]),
    "Distributors",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[...RECEIVABLE_HEADERS]]),
    "Receivables",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[...PAYMENT_HEADERS]]),
    "Payments",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(instructions),
    "Instructions",
  );
  return workbook;
}
