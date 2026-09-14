import type { SupabaseClient } from "@supabase/supabase-js";
import * as xlsx from "xlsx";
import { z } from "zod";
import { ReportUnavailable, type ReportResource } from "@/lib/analytics/reportResource";
import { getISTBusinessDayBounds, isValidISTDateKey } from "@/lib/dateTime";
import { buildErpIntelligenceExportRows } from "@/app/api/admin/export-visits/exportRows";
import { getOutcomeLabel } from "./contract";
import { parseVisitRegister, visitUuid } from "./range";

export const VISIT_EXPORT_LIMITS = { rows: 5000, pageRows: 500, sourceBytes: 4 * 1024 * 1024, workbookBytes: 8 * 1024 * 1024 } as const;
export function parseVisitExport(params: URLSearchParams, now: string) {
  const normalized = new URLSearchParams(params);
  if (normalized.has("page") || normalized.getAll("agent").length > 1
    || (normalized.has("agent") && normalized.has("representative"))) throw new Error("INVALID_VISIT_EXPORT_SCOPE");
  // Preserve the historical alias at this boundary only; readers use representative.
  if (normalized.has("agent")) { normalized.set("representative", normalized.get("agent")!); normalized.delete("agent"); }
  const scope = parseVisitRegister(normalized, now);
  if (!scope.date && (!scope.date_from || !scope.date_to)) throw new Error("VISIT_EXPORT_RANGE_REQUIRED");
  return scope;
}
export type VisitExportScope = ReturnType<typeof parseVisitExport>;
const text = z.string().max(32767).nullable();
const day = z.string().refine(isValidISTDateKey);
const exportRow = z.object({
  visit_id: visitUuid, user_id: visitUuid, lead_id: z.string().max(32767),
  created_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => Number.isFinite(Date.parse(value))),
  visit_date: day, check_in_time: z.string().datetime({ offset: true }),
  check_in_lat: z.number().finite().nullable(), check_in_lng: z.number().finite().nullable(),
  address: text, pincode: text, segment_type: text, person_met: text, visit_outcome: text,
  visit_notes: text, follow_up_date: day.nullable(), erp_usage_state: z.enum(["erp", "none"]).nullable(),
  erp_name: text, representative_name: text, representative_email: text, business_name: text,
  selfie_status: z.enum(["expired", "available", "pending"]),
}).strict();
export type VisitExportRow = z.infer<typeof exportRow>;
const count = z.number().int().nonnegative().safe();
const percent = z.number().finite().min(0).max(100);
const erpSegment = z.object({
  unique_businesses: count, observed_count: count, erp_using_count: count, none_count: count,
  not_captured_count: count, coverage_percent: percent,
  categories: z.array(z.object({ erp_name: z.string().refine(value => [...value].length <= 160).nullable(), count, share_percent: percent })).max(1000),
}).superRefine((s, ctx) => {
  const rounded = (n: number) => s.unique_businesses ? Math.round(1000 * n / s.unique_businesses) / 10 : 0;
  if (s.observed_count !== s.erp_using_count + s.none_count
    || s.unique_businesses !== s.observed_count + s.not_captured_count
    || s.categories.reduce((n, c) => n + c.count, 0) !== s.unique_businesses
    || s.coverage_percent !== rounded(s.observed_count)
    || s.categories.some(c => c.share_percent !== rounded(c.count))) ctx.addIssue({ code: "custom", message: "ERP_EXPORT_RECONCILIATION" });
});
export const exportErpSchema = z.object({ Retailer: erpSegment, Distributor: erpSegment }).strict();
export type VisitExportErp = z.infer<typeof exportErpSchema>;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export async function readVisitExport(client: SupabaseClient, scope: VisitExportScope, resource: ReportResource) {
  const rows: VisitExportRow[] = [], seen = new Set<string>();
  let cursor: VisitExportRow | undefined, receivedBytes = 0;
  const legacy = scope.date ? getISTBusinessDayBounds(scope.date) : null;
  // Reserve one of the SAME24 reader attempts for independently scoped ERP. EOF is charged.
  for (let page = 0; page < 23; page++) {
    const result = await resource.read(client.rpc("crm_visit_export_v1", {
      p_from: scope.date_from ?? null, p_to: scope.date_to ?? null, p_legacy_date: scope.date ?? null,
      p_representative: scope.representative, p_segment: scope.segment, p_outcome: scope.outcome, p_search: scope.search,
      p_after_created: cursor?.created_at ?? null, p_after_id: cursor?.visit_id ?? null,
    }));
    if (result.error) throw new ReportUnavailable(result.error.code === "PGRST202" ? "VISIT_EXPORT_ACTIVATION_REQUIRED" : "VISIT_EXPORT_SOURCE_UNAVAILABLE_OR_LIMITED");
    const pageBytes = bytes(result.data); receivedBytes += pageBytes;
    if (pageBytes > 1024 * 1024 || receivedBytes > VISIT_EXPORT_LIMITS.sourceBytes) throw new ReportUnavailable("VISIT_EXPORT_SOURCE_LIMIT");
    const batch = z.array(exportRow).max(VISIT_EXPORT_LIMITS.pageRows).parse(result.data);
    if (!batch.length) return rows;
    for (const row of batch) {
      const key = `${row.created_at}/${row.visit_id}`;
      const inDate = scope.date ? row.visit_date === scope.date || (legacy && Date.parse(row.check_in_time) >= Date.parse(legacy.startsAt) && Date.parse(row.check_in_time) < Date.parse(legacy.endsAt))
        : row.visit_date >= scope.date_from! && row.visit_date <= scope.date_to!;
      if (!inDate || (scope.representative && row.user_id !== scope.representative)
        || (scope.segment && row.segment_type !== scope.segment) || (scope.outcome && row.visit_outcome !== scope.outcome)
        || seen.has(row.visit_id) || (cursor && key >= `${cursor.created_at}/${cursor.visit_id}`)) throw new ReportUnavailable("VISIT_EXPORT_SCOPE_OR_ORDER");
      seen.add(row.visit_id); rows.push(row); cursor = row;
    }
    if (rows.length > VISIT_EXPORT_LIMITS.rows) throw new ReportUnavailable("VISIT_EXPORT_ROW_LIMIT");
  }
  throw new ReportUnavailable("VISIT_EXPORT_REQUEST_LIMIT");
}

export async function readVisitExportErp(client: SupabaseClient, resource: ReportResource) {
  const result = await resource.read(client.rpc("crm_visit_export_erp_v1"));
  if (result.error) throw new ReportUnavailable(result.error.code === "PGRST202" ? "VISIT_EXPORT_ACTIVATION_REQUIRED" : "VISIT_EXPORT_ERP_UNAVAILABLE_OR_LIMITED");
  if (bytes(result.data) > 1024 * 1024) throw new ReportUnavailable("VISIT_EXPORT_ERP_LIMIT");
  return exportErpSchema.parse(result.data);
}

export function buildVisitExportWorkbook(visits: VisitExportRow[], erp: VisitExportErp, scope: VisitExportScope, resource: ReportResource) {
  resource.check();
  const rows = visits.map(visit => ({
    "Visit ID": visit.visit_id,
    Representative: visit.representative_name ?? `Unknown representative · ${visit.user_id.slice(0, 8)}`,
    "Representative email": visit.representative_email ?? "Unavailable",
    "Visit date": visit.visit_date,
    "Check-in time": new Date(visit.check_in_time).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    Segment: visit.segment_type, Business: visit.business_name?.trim() || visit.lead_id?.trim() || "Unavailable business",
    "Person met": visit.person_met ?? "", [scope.segment === "Retailer" ? "Area" : "Address"]: visit.address ?? "Legacy visit — address not captured",
    Pincode: visit.pincode ?? "", Latitude: visit.check_in_lat ?? "", Longitude: visit.check_in_lng ?? "",
    Outcome: getOutcomeLabel(String(visit.visit_outcome)),
    ERP: visit.erp_usage_state === "erp" ? (visit.erp_name ?? "Not captured") : visit.erp_usage_state === "none" ? "None" : "Not captured",
    "ERP Capture State": visit.erp_usage_state === "erp" ? "ERP" : visit.erp_usage_state === "none" ? "None" : "Not captured",
    "Follow-up date": visit.follow_up_date ?? "", Notes: visit.visit_notes ?? "",
    "Selfie status": visit.selfie_status === "expired" ? "Expired after 5-day retention" : visit.selfie_status === "available" ? "Available" : "Pending",
  }));
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(rows), "Field Visits");
  for (const segment of ["Retailer", "Distributor"] as const) {
    const value = { ...erp[segment], categories: erp[segment].categories.map(c => ({ ...c, erp_name: c.erp_name ?? "Unavailable ERP label" })) };
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(buildErpIntelligenceExportRows(segment, value)), `${segment} ERP`);
  }
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { Sheet: "Field Visits", Scope: JSON.stringify(scope), Meaning: "Retained records matching the applied register predicate; bounded live reads, not a frozen snapshot." },
    { Sheet: "Retailer ERP / Distributor ERP", Scope: "All retained visits, independently of the selected register filters", Meaning: "Latest observed ERP per segment and business (048); not current ERP overrides or selected-range composition." },
  ]), "Scope");
  resource.check();
  // Synchronous XLSX work is bounded by source/cell limits; the timer cannot preempt it.
  const buffer: Buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
  resource.check();
  if (buffer.byteLength > VISIT_EXPORT_LIMITS.workbookBytes) throw new ReportUnavailable("VISIT_EXPORT_WORKBOOK_LIMIT");
  return buffer;
}
