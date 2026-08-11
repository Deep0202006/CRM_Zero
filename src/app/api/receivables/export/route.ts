import * as XLSX from "xlsx";
import { apiError, contextFor, isReceivablesReady } from "@/lib/receivables/server";
import { applyReceivableFilters } from "@/lib/receivables/filters";
import { parseReceivablesFilters } from "@/lib/receivables/validation";
import { collectBoundedExportRows, ExportTooLargeError, receivablesExportFilename, toReceivableExportRow } from "@/lib/receivables/export";

export async function GET(request: Request) {
  if (!isReceivablesReady()) return apiError(503, "RECEIVABLES_UNAVAILABLE", "Payment Collections are not activated yet.");
  const context = await contextFor(request);
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  if (!context.isAdmin) return apiError(403, "ADMIN_REQUIRED", "System Administrator access required.");
  const url = new URL(request.url);
  url.searchParams.delete("page");
  url.searchParams.delete("pageSize");
  const parsed = parseReceivablesFilters(new URL(`${url.origin}${url.pathname}?${url.searchParams.toString()}&page=1&pageSize=50`));
  if (!parsed.success) return apiError(400, "INVALID_FILTER", "Invalid export filter.");

  let rows: Record<string, unknown>[];
  try {
    rows = await collectBoundedExportRows(async (from, to) => {
      let query = context.service.from("receivables_financial_read_v1").select("distributor_name,contact_person,bill_reference,bill_amount,confirmed_paid_amount,outstanding_amount,bill_due_date,next_follow_up_date,assigned_to,payment_state,lifecycle_status,aging_bucket,created_at");
      query = applyReceivableFilters(query, parsed.data, true).order("created_at", { ascending: false }).order("receivable_id", { ascending: true }).range(from, to);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    });
  } catch (error) {
    if (error instanceof ExportTooLargeError) return apiError(413, "EXPORT_TOO_LARGE", "Narrow the filters before exporting more than 10,000 rows.");
    return apiError(503, "EXPORT_FAILED", "Filtered export could not be generated.");
  }

  const ownerIds = [...new Set(rows.map(row => String(row.assigned_to)))];
  const { data: owners } = ownerIds.length ? await context.service.from("users").select("user_id,name").in("user_id", ownerIds) : { data: [] };
  const names = new Map((owners ?? []).map(owner => [owner.user_id, owner.name]));
  const output = rows.map(row => toReceivableExportRow(row, names.get(row.assigned_to) ?? "Assigned employee"));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(output), "Payment Collections");
  const body = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new Response(body, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${receivablesExportFilename()}"`, "Cache-Control": "no-store" } });
}
