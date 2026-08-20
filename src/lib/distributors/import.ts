import { isValidISTDateKey } from "@/lib/dateTime";
import { validateStatusCombination } from "./domain";

export const DISTRIBUTOR_IMPORT_HEADERS = [
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
  "Bill Reference",
  "Renewal Date",
  "Distributor Reference",
  "ERP",
] as const;
export const MAX_DISTRIBUTOR_IMPORT_ROWS = 5_000;
export const MAX_DISTRIBUTOR_IMPORT_BYTES = 10 * 1024 * 1024;
type Cell = string | number | boolean | Date | null | undefined;

export interface DistributorImportRow {
  rowNumber: number;
  distributorName: string;
  assignedEmployeeEmail: string;
  installationStatus: string;
  installationDate: string;
  trainingStatus: string;
  trainingDate: string;
  mappingStatus: string;
  mappedDate: string;
  activityStatus: string;
  billingStatus: string;
  billDate: string;
  billReference: string;
  renewalDate: string;
  distributorReference: string;
  erpName?: string;
}

function dateValue(value: Cell) {
  if (value === null || value === undefined || String(value).trim() === "")
    return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number")
    return new Date(Date.UTC(1899, 11, 30 + value)).toISOString().slice(0, 10);
  const text = String(value).trim(),
    match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : match
      ? `${match[3]}-${match[2]}-${match[1]}`
      : "";
  if (!isValidISTDateKey(iso))
    throw new Error("Invalid date. Use YYYY-MM-DD or DD/MM/YYYY.");
  return iso;
}

export function parseDistributorTable(table: Cell[][]) {
  if (!table.length) throw new Error("The spreadsheet is empty.");
  if (table.length - 1 > MAX_DISTRIBUTOR_IMPORT_ROWS)
    throw new Error("Maximum 5,000 data rows allowed.");
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\s_-]+/g, " ")
      .trim();
  const labels = table[0].map((value) => String(value ?? "").trim()),
    normalized = labels.map(normalize);
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Duplicate spreadsheet headers are not allowed.");
  const allowed = new Set(DISTRIBUTOR_IMPORT_HEADERS.map(normalize)),
    unknown = labels.filter(
      (label, index) => label && !allowed.has(normalized[index]),
    );
  if (unknown.length)
    throw new Error(`Unknown columns are not allowed: ${unknown.join(", ")}.`);
  const required = [
      "Distributor Name",
      "Assigned Employee Email",
      "Installation Status",
      "Training Status",
      "Mapping Status",
      "Activity Status",
      "Billing Status",
    ],
    index = new Map<string, number>();
  DISTRIBUTOR_IMPORT_HEADERS.forEach((header) =>
    index.set(header, normalized.indexOf(normalize(header))),
  );
  const missing = required.filter((header) => (index.get(header) ?? -1) < 0);
  if (missing.length)
    throw new Error(`Missing required columns: ${missing.join(", ")}.`);
  const rows: DistributorImportRow[] = [],
    invalid: Array<{ rowNumber: number; reason: string }> = [];
  const at = (source: Cell[], header: string) =>
    source[index.get(header) ?? -1];
  table.slice(1).forEach((source, offset) => {
    if (source.every((value) => String(value ?? "").trim() === "")) return;
    const rowNumber = offset + 2;
    try {
      for (const header of required)
        if (!String(at(source, header) ?? "").trim())
          throw new Error(`Missing required value: ${header}.`);
      const row: DistributorImportRow = {
        rowNumber,
        distributorName: String(at(source, "Distributor Name")).trim(),
        assignedEmployeeEmail: String(at(source, "Assigned Employee Email"))
          .trim()
          .toLowerCase(),
        installationStatus: String(at(source, "Installation Status"))
          .trim()
          .toLowerCase(),
        installationDate: dateValue(at(source, "Installation Date")),
        trainingStatus: String(at(source, "Training Status"))
          .trim()
          .toLowerCase(),
        trainingDate: dateValue(at(source, "Training Date")),
        mappingStatus: String(at(source, "Mapping Status"))
          .trim()
          .toLowerCase(),
        mappedDate: dateValue(at(source, "Mapped Date")),
        activityStatus: String(at(source, "Activity Status"))
          .trim()
          .toLowerCase(),
        billingStatus: String(at(source, "Billing Status"))
          .trim()
          .toLowerCase(),
        billDate: dateValue(at(source, "Bill Date")),
        billReference: String(at(source, "Bill Reference") ?? "").trim(),
        renewalDate: dateValue(at(source, "Renewal Date")),
        distributorReference: String(
          at(source, "Distributor Reference") ?? "",
        ).trim(),
        erpName: String(at(source, "ERP") ?? "")
          .normalize("NFKC")
          .trim()
          .replace(/\s+/g, " "),
      };
      if ((row.erpName ?? "").length > 160)
        throw new Error("ERP must be at most 160 characters.");
      if (!["pending", "done"].includes(row.installationStatus))
        throw new Error("Invalid Installation Status.");
      if (!["pending", "done"].includes(row.trainingStatus))
        throw new Error("Invalid Training Status.");
      if (!["pending", "done"].includes(row.mappingStatus))
        throw new Error("Invalid Mapping Status.");
      if (
        !["not_applicable", "active", "inactive"].includes(row.activityStatus)
      )
        throw new Error("Invalid Activity Status.");
      if (!["not_billed", "billed"].includes(row.billingStatus))
        throw new Error("Invalid Billing Status.");
      const stateError = validateStatusCombination({
        installation_status: row.installationStatus,
        training_status: row.trainingStatus,
        mapping_status: row.mappingStatus,
        mapped_at: row.mappedDate || null,
        activity_status: row.activityStatus,
      });
      if (stateError) throw new Error(stateError);
      rows.push(row);
    } catch (error) {
      invalid.push({
        rowNumber,
        reason: error instanceof Error ? error.message : "Invalid row.",
      });
    }
  });
  return { rows, invalid };
}
