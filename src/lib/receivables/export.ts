import { getISTDateKey } from "@/lib/dateTime";

const FORMULA_PREFIX = /^\s*[=+\-@]/;
export const MAX_EXPORT_ROWS = 10000;
export class ExportTooLargeError extends Error {}

export async function collectBoundedExportRows<T>(fetchPage: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from <= MAX_EXPORT_ROWS; from += 500) {
    const requested = Math.min(500, MAX_EXPORT_ROWS + 1 - from);
    const page = await fetchPage(from, from + requested - 1);
    rows.push(...page);
    if (rows.length > MAX_EXPORT_ROWS) throw new ExportTooLargeError("Export exceeds 10,000 rows.");
    if (page.length < requested) break;
  }
  return rows;
}

/** Prevent user-controlled text from becoming executable spreadsheet formulas. */
export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function receivablesExportFilename(now = new Date()): string {
  return `Payment_Collections_${getISTDateKey(now)}.xlsx`;
}

export function toReceivableExportRow(row: Record<string, unknown>, ownerName: string) {
  return {
    Distributor: spreadsheetSafeText(row.distributor_name),
    ERP: spreadsheetSafeText(row.erp_name ?? "Not Set"),
    Contact: spreadsheetSafeText(row.contact_person),
    "Bill Ref": spreadsheetSafeText(row.bill_reference),
    "Bill Amount": row.bill_amount,
    "Confirmed Received": row.confirmed_paid_amount,
    Outstanding: row.outstanding_amount,
    "Bill Due Date": row.bill_due_date,
    "Next Follow-up": row.next_follow_up_date,
    Owner: spreadsheetSafeText(ownerName),
    "Payment State": row.payment_state,
    "Lifecycle State": row.lifecycle_status,
    Aging: row.aging_bucket,
    "Created At": row.created_at,
  };
}
