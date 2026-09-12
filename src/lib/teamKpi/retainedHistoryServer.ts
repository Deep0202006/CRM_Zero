import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ReportUnavailable, type ReportResource } from "@/lib/analytics/reportResource";
import { getISTBusinessDayBounds, isValidISTDateKey, IST_TIMEZONE } from "@/lib/dateTime";
import { visitUuid } from "@/lib/fieldVisits/range";
import type { CanonicalCallLog } from "@/lib/workMetrics/canonical";
import type { HistoryScope } from "./history";
import type { RetainedEvent } from "./retainedHistory";

// Keep PostgreSQL microseconds: Date.toISOString() alone loses cursor precision.
export function historyTimestamp(value: string) {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) throw new ReportUnavailable("HISTORY_TIMESTAMP_INVALID");
  return `${new Date(value).toISOString().slice(0, 19)}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
const timestamp = z.string().transform(historyTimestamp);
const callSchema = z.object({ log_id: visitUuid, user_id: visitUuid, timestamp, outcome: z.string().max(4000).nullable() });
const visitSchema = z.object({ visit_id: visitUuid, user_id: visitUuid, visit_date: z.string().refine(isValidISTDateKey), check_in_time: timestamp });
const mappingSchema = z.object({ request_id: visitUuid, mapped_by: visitUuid.nullable(), mapped_by_id_snapshot: visitUuid, completed_at: timestamp, status: z.literal("Completed") })
  .refine(row => row.mapped_by === null || row.mapped_by === row.mapped_by_id_snapshot, "Mapping lifecycle attribution mismatch");

// Shared source reader, not a Team loader. Personal callers supply only the
// verified actor; cohort restriction is part of every database predicate.
export async function readRetainedHistory(client: SupabaseClient, scope: HistoryScope, ids: string[], generatedAt: string, resource: ReportResource) {
  const cohort = z.array(visitUuid).min(1).max(200).parse(ids), allowed = new Set(cohort);
  if (allowed.size !== cohort.length) throw new ReportUnavailable("HISTORY_COHORT_UNAVAILABLE");
  const metric = scope.metric ?? "calls_made", mapping = metric === "mappings_completed", visits = metric === "visits";
  const start = historyTimestamp(getISTBusinessDayBounds(mapping ? scope.from : scope.previous_from).startsAt);
  const end = [historyTimestamp(getISTBusinessDayBounds(scope.to).endsAt), historyTimestamp(generatedAt)].sort()[0];
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: IST_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const calls: CanonicalCallLog[] = [], events: RetainedEvent[] = [], seen = new Set<string>();
  let cursor: { time: string; id: string } | null = null, bytes = 0;
  for (let page = 0; page < 21; page++) {
    const timeColumn = visits ? "visit_date" : mapping ? "completed_at" : "timestamp", idColumn = visits ? "visit_id" : mapping ? "request_id" : "log_id";
    let query = visits
      ? client.from("field_visits").select("visit_id,user_id,visit_date,check_in_time").in("user_id", cohort).gte("visit_date", scope.previous_from).lte("visit_date", scope.to)
      : mapping
        ? client.from("mapping_requests").select("request_id,mapped_by,mapped_by_id_snapshot,completed_at,status").in("mapped_by_id_snapshot", cohort).eq("status", "Completed").gte("completed_at", start).lt("completed_at", end)
        : client.from("call_logs").select("log_id,user_id,timestamp,outcome").in("user_id", cohort).gte("timestamp", start).lt("timestamp", end);
    if (cursor) query = query.or(`${timeColumn}.gt.${cursor.time},and(${timeColumn}.eq.${cursor.time},${idColumn}.gt.${cursor.id})`);
    const result = await resource.read<{ data: unknown[] | null; error: unknown }>(query.order(timeColumn).order(idColumn).limit(1000));
    if (result.error || !Array.isArray(result.data)) throw new ReportUnavailable("HISTORY_SOURCE_UNAVAILABLE");
    bytes += new TextEncoder().encode(JSON.stringify(result.data)).byteLength;
    if (result.data.length > 1000 || bytes > 4 * 1024 * 1024) throw new ReportUnavailable("HISTORY_SOURCE_LIMIT");
    if (!result.data.length) return { calls, events };
    for (const raw of result.data) {
      let event: RetainedEvent;
      if (visits) { const row = visitSchema.parse(raw); event = { id: row.visit_id, user_id: row.user_id, date: row.visit_date, timestamp: row.check_in_time }; }
      else if (mapping) { const row = mappingSchema.parse(raw); event = { id: row.request_id, user_id: row.mapped_by_id_snapshot, date: formatter.format(new Date(row.completed_at)), timestamp: row.completed_at }; }
      else { const row = callSchema.parse(raw); calls.push(row); event = { id: row.log_id, user_id: row.user_id, date: formatter.format(new Date(row.timestamp)), timestamp: row.timestamp }; }
      const time = visits ? event.date : event.timestamp;
      if (!allowed.has(event.user_id) || seen.has(event.id) || event.date < (mapping ? scope.from : scope.previous_from) || event.date > scope.to
        || (!visits && (event.timestamp >= end || event.timestamp < start))
        || (cursor && (time < cursor.time || (time === cursor.time && event.id <= cursor.id)))) throw new ReportUnavailable("HISTORY_SOURCE_SCOPE_OR_ORDER");
      cursor = { time, id: event.id }; seen.add(event.id); events.push(event);
    }
    if (seen.size > 20000) throw new ReportUnavailable("HISTORY_SOURCE_LIMIT");
  }
  throw new ReportUnavailable("HISTORY_SOURCE_LIMIT");
}
