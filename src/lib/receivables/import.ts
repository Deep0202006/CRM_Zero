import { minorUnitsToDecimal, parseMoneyToMinorUnits } from "./domain";
export const MAX_IMPORT_ROWS = 5000; export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const RECEIVABLE_HEADERS = ["Bill Reference", "Distributor Name", "Contact Person", "Contact Phone", "Bill Amount", "Bill Due Date", "Payment Follow-up Date", "Assigned Employee Email", "Distributor Code", "Notes"] as const;
const required = new Set(["Bill Reference", "Distributor Name", "Contact Person", "Bill Amount", "Bill Due Date", "Payment Follow-up Date", "Assigned Employee Email"]);
type Cell = string | number | boolean | Date | null | undefined;
export interface ImportRow { rowNumber: number; billReference: string; distributorName: string; contactPerson: string; contactPhone: string; billAmount: string; billDueDate: string; nextFollowUpDate: string; assignedEmployeeEmail: string; distributorCode: string; notes: string; }
export interface InvalidImportRow { rowNumber: number; reason: string }
function clean(v: Cell) { return v instanceof Date ? v : String(v ?? "").trim(); }
function dateValue(value: Cell): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === "number" && Number.isInteger(value) && value > 0) { const d = new Date(Date.UTC(1899, 11, 30 + value)); return d.toISOString().slice(0, 10); }
  const text = String(value ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text); if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text); if (m) {
    return validDate(+m[3], +m[2], +m[1]);
  }
  throw new Error("Use YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY.");
}
function validDate(y: number, m: number, d: number) { const result = new Date(Date.UTC(y, m - 1, d)); if (result.getUTCFullYear() !== y || result.getUTCMonth() !== m - 1 || result.getUTCDate() !== d) throw new Error("Invalid date."); return `${y.toString().padStart(4,"0")}-${m.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`; }
export function parseReceivablesTable(table: Cell[][]): { rows: ImportRow[]; invalid: InvalidImportRow[] } {
  if (!table.length) throw new Error("The spreadsheet is empty."); if (table.length - 1 > MAX_IMPORT_ROWS) throw new Error("Maximum 5,000 data rows allowed.");
  const labels = table[0].map(v => String(v ?? "").trim()); const normalizeHeader=(v:string)=>v.toLowerCase().replace(/[\s_-]+/g, " "); const normalized = labels.map(normalizeHeader);
  if (new Set(normalized).size !== normalized.length) throw new Error("Duplicate spreadsheet headers are not allowed.");
  const allowed = new Set(RECEIVABLE_HEADERS.map(normalizeHeader)); const unknown = labels.filter((label, position) => label && !allowed.has(normalized[position]));
  if (unknown.length) throw new Error(`Unknown columns are not allowed: ${unknown.join(", ")}.`);
  const index = new Map<string, number>(); RECEIVABLE_HEADERS.forEach(h => { const i = normalized.indexOf(normalizeHeader(h)); if (i >= 0) index.set(h, i); });
  const missing = [...required].filter(h => !index.has(h)); if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
  const rows: ImportRow[] = [], invalid: InvalidImportRow[] = []; const value = (source: Cell[], h: string) => source[index.get(h) ?? -1];
  table.slice(1).forEach((source, offset) => {
    if (source.every(v => String(v ?? "").trim() === "")) return; const rowNumber = offset + 2;
    try {
      for (const h of required) if (!String(value(source, h) ?? "").trim()) throw new Error(`Missing required value: ${h}.`);
      rows.push({ rowNumber, billReference: String(clean(value(source,"Bill Reference"))), distributorName: String(clean(value(source,"Distributor Name"))), contactPerson: String(clean(value(source,"Contact Person"))), contactPhone: String(clean(value(source,"Contact Phone"))), billAmount: minorUnitsToDecimal(parseMoneyToMinorUnits(value(source,"Bill Amount") as string | number)), billDueDate: dateValue(value(source,"Bill Due Date")), nextFollowUpDate: dateValue(value(source,"Payment Follow-up Date")), assignedEmployeeEmail: String(clean(value(source,"Assigned Employee Email"))).toLowerCase(), distributorCode: String(clean(value(source,"Distributor Code"))), notes: String(clean(value(source,"Notes"))) });
    } catch (error) { invalid.push({ rowNumber, reason: error instanceof Error ? error.message : "Invalid row." }); }
  }); return { rows, invalid };
}
