import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { addISTDateDays, getISTDateKey, isValidISTDateKey } from "@/lib/dateTime";
import { ReportUnavailable, type ReportResource } from "@/lib/analytics/reportResource";
import { FIELD_VISIT_OUTCOMES } from "./contract";

const date = z.string().refine(isValidISTDateKey);
// PostgreSQL UUID is a 128-bit identity, not restricted to RFC version/variant bits.
export const visitUuid = z.string().regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).transform((id) => id.toLowerCase());
const scopeSchema = z.object({
  version: z.literal("1").default("1"), date_from: date, date_to: date,
  representative: visitUuid.nullable().default(null),
  segment: z.enum(["Retailer", "Distributor"]).nullable().default(null),
  outcome: z.enum(FIELD_VISIT_OUTCOMES).nullable().default(null),
  search: z.string().trim().max(160).default(""),
}).strict();
export type VisitRangeScope = z.infer<typeof scopeSchema>;
const registerSchema = scopeSchema.omit({ date_from: true, date_to: true }).extend({
  date: date.optional(), date_from: date.optional(), date_to: date.optional(),
  page: z.coerce.number().int().min(1).max(400).default(1),
});
export function parseVisitRegister(params: URLSearchParams, now: string) {
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new Error("INVALID_VISIT_REGISTER_SCOPE");
  const scope = registerSchema.parse(Object.fromEntries(params));
  const today = getISTDateKey(now);
  if (Boolean(scope.date_from) !== Boolean(scope.date_to) || (scope.date && (scope.date_from || scope.date_to))
    || [scope.date, scope.date_from, scope.date_to].some((day) => day && (day < "1000-02-01" || day > today))
    || (scope.date_from && scope.date_to && (scope.date_from > scope.date_to || scope.date_to > addISTDateDays(scope.date_from, 30)))) throw new Error("INVALID_VISIT_REGISTER_SCOPE");
  return scope;
}
export const visitRegisterResultSchema = z.object({
  visit_ids: z.array(visitUuid).max(50),
  total: z.number().int().nonnegative().safe(), page: z.number().int().min(1).max(400),
  page_size: z.literal(50), has_more: z.boolean(), page_limit: z.literal(400),
  legacy_date_mismatch_count: z.number().int().nonnegative().safe(),
}).superRefine((value, context) => {
  if (new Set(value.visit_ids).size !== value.visit_ids.length || value.visit_ids.length !== Math.min(50, Math.max(0, value.total - (value.page - 1) * 50))
    || value.has_more !== (value.page * 50 < value.total) || value.legacy_date_mismatch_count > value.total) context.addIssue({ code: "custom", message: "VISIT_REGISTER_RECONCILIATION" });
});
export function parseVisitRange(params: URLSearchParams, now: string): VisitRangeScope {
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new Error("INVALID_VISIT_RANGE");
  const today = getISTDateKey(now);
  const input = Object.fromEntries(params);
  const scope = scopeSchema.parse({ date_from: addISTDateDays(today, -6), date_to: today, ...input });
  if (scope.date_from < "1000-02-01" || scope.date_from > scope.date_to || scope.date_to > today || scope.date_to > addISTDateDays(scope.date_from, 30)) throw new Error("INVALID_VISIT_RANGE");
  return scope;
}
const eventSchema = z.object({ visit_id: visitUuid, user_id: visitUuid, visit_date: date, check_in_time: z.string().datetime({ offset: true }), visit_outcome: z.string().nullable(), segment_type: z.string().nullable() });
export type VisitEvent = z.infer<typeof eventSchema>;

export async function readVisitEvents(client: SupabaseClient, scope: VisitRangeScope, resource: ReportResource) {
  const rows: VisitEvent[] = [];
  let cursor: VisitEvent | undefined;
  for (let page = 0; page < 21; page++) {
    const result = await resource.read(client.rpc("crm_visit_events_v1", {
      p_from: scope.date_from, p_to: scope.date_to, p_representative: scope.representative,
      p_segment: scope.segment, p_outcome: scope.outcome, p_search: scope.search,
      p_after_date: cursor?.visit_date ?? null, p_after_id: cursor?.visit_id ?? null,
    }));
    if (result.error) throw new ReportUnavailable(result.error.code === "PGRST202" ? "VISIT_READER_ACTIVATION_REQUIRED" : "VISIT_SOURCE_UNAVAILABLE");
    const batch = z.array(eventSchema).max(1000).parse(result.data);
    // A short page may be the server response cap. Only an empty EOF establishes exhaustion.
    if (!batch.length) return rows;
    for (const row of batch) {
      const key = `${row.visit_date}:${row.visit_id}`;
      if (row.visit_date < scope.date_from || row.visit_date > scope.date_to || (scope.representative && row.user_id !== scope.representative)
        || (scope.segment && row.segment_type !== scope.segment) || (scope.outcome && row.visit_outcome !== scope.outcome)
        || (cursor && key <= `${cursor.visit_date}:${cursor.visit_id}`)) throw new ReportUnavailable("VISIT_SOURCE_SCOPE_OR_ORDER");
      cursor = row;
      rows.push(row);
    }
    if (rows.length > 20000) throw new ReportUnavailable("VISIT_SOURCE_LIMIT");
  }
  throw new ReportUnavailable("VISIT_SOURCE_LIMIT");
}

export function aggregateVisitRange(scope: VisitRangeScope, rows: VisitEvent[]) {
  const unique = [...new Map(rows.map((row) => [row.visit_id, row])).values()];
  const daily: Array<{ date: string; count: number }> = [];
  for (let day = scope.date_from; day <= scope.date_to; day = addISTDateDays(day, 1)) daily.push({ date: day, count: 0 });
  const days = new Map(daily.map((day) => [day.date, day]));
  const outcomes = new Map<string, number>(), representatives = new Map<string, number>();
  let mismatches = 0;
  for (const row of unique) {
    const day = days.get(row.visit_date);
    if (!day) throw new ReportUnavailable("VISIT_SOURCE_SCOPE_OR_ORDER");
    day.count++;
    const outcome = FIELD_VISIT_OUTCOMES.some((value) => value === row.visit_outcome) ? row.visit_outcome! : "unknown";
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    representatives.set(row.user_id, (representatives.get(row.user_id) ?? 0) + 1);
    if (getISTDateKey(row.check_in_time) !== row.visit_date) mismatches++;
  }
  return {
    retained_visit_count: unique.length, daily,
    outcomes: [...outcomes].map(([outcome, count]) => ({ outcome, count })),
    representatives: representatives.size > 200 ? null : [...representatives].map(([user_id, count]) => ({ user_id, count })),
    representative_breakdown: representatives.size > 200 ? "unavailable-cardinality-limit" : "exhausted",
    date_mismatch_count: mismatches,
  };
}
