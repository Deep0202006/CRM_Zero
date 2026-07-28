import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const visitReportFiltersSchema = z.object({
  from: dateKey,
  to: dateKey,
  representative: z.string().uuid().nullable().default(null),
  segment: z.enum(["Retailer", "Distributor"]).nullable().default(null),
  outcomes: z.array(z.string().min(1).max(80)).max(20).default([]),
  search: z.string().trim().max(120).nullable().default(null),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sortDesc: z.boolean().default(true),
}).refine((value) => value.from <= value.to, "The visit date range is invalid.");

export type VisitReportFilters = z.infer<typeof visitReportFiltersSchema>;

export interface VisitReportRow {
  visit_id: string;
  lead_id: string;
  user_id: string;
  visit_date: string;
  check_in_time: string;
  check_in_lat: number | null;
  check_in_lng: number | null;
  location_accuracy_m: number | null;
  location_quality: string | null;
  location_captured_at: string | null;
  selfie_captured_at: string | null;
  selfie_storage_path: string | null;
  visit_outcome: string;
  visit_notes: string | null;
  person_met: string | null;
  segment_type: string | null;
  follow_up_date: string | null;
  representative_name: string;
  representative_email: string;
  business_name: string | null;
  contact_person: string | null;
  phone: string | null;
}

export interface VisitReport {
  rows: VisitReportRow[];
  totals: { total: number; retailer: number; distributor: number };
  filters: Record<string, unknown>;
  generated_at: string;
}

export async function loadVisitReport(
  client: SupabaseClient,
  input: VisitReportFilters,
): Promise<VisitReport> {
  const filters = visitReportFiltersSchema.parse(input);
  const { data, error } = await client.rpc("get_admin_visit_report_v1", {
    p_from_date: filters.from,
    p_to_date: filters.to,
    p_representative: filters.representative,
    p_segment: filters.segment,
    p_outcomes: filters.outcomes.length > 0 ? filters.outcomes : null,
    p_search: filters.search || null,
    p_page: filters.page,
    p_page_size: filters.pageSize,
    p_sort_desc: filters.sortDesc,
  });
  if (error) throw Object.assign(new Error("Visit report could not be generated."), { code: error.code });
  const parsed = z.object({
    rows: z.array(z.record(z.string(), z.unknown())),
    totals: z.object({
      total: z.coerce.number().int().nonnegative(),
      retailer: z.coerce.number().int().nonnegative(),
      distributor: z.coerce.number().int().nonnegative(),
    }),
    filters: z.record(z.string(), z.unknown()),
    generated_at: z.string(),
  }).parse(data);
  return parsed as unknown as VisitReport;
}
