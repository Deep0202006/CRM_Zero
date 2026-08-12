import type { SupabaseClient } from "@supabase/supabase-js";
import { generateEvidencePath } from "./contract";

export const SELFIE_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
export const SELFIE_RETENTION_BATCH_SIZE = 200;
export const SELFIE_BUCKET = "visits-evidence";

type EvidenceKind = "visit" | "attendance";
type Candidate = { kind: EvidenceKind; id: string; userId: string; date: string; path: string };
export interface RetentionResult { scanned: number; deleted: number; failed: number; rejected: number; visitsPurged: number; attendancePurged: number; }

export function retentionCutoff(now = new Date()): string {
  return new Date(now.getTime() - SELFIE_RETENTION_MS).toISOString();
}

export function attendanceEvidencePath(userId: string, date: string, attendanceId: string): string {
  return `attendance/${userId}/${date}/${attendanceId}.jpg`;
}

export function isExactAuthoritativePath(candidate: Candidate): boolean {
  const expected = candidate.kind === "visit"
    ? generateEvidencePath(candidate.userId, candidate.date, candidate.id)
    : attendanceEvidencePath(candidate.userId, candidate.date, candidate.id);
  return candidate.path === expected;
}

async function candidates(client: SupabaseClient, cutoff: string, limit: number): Promise<Candidate[]> {
  const visitLimit = Math.ceil(limit / 2);
  const attendanceLimit = limit - visitLimit;
  const [visits, attendance] = await Promise.all([
    client.from("field_visits")
      .select("visit_id,user_id,visit_date,selfie_storage_path,selfie_uploaded_at,selfie_purge_state,selfie_purge_started_at")
      .not("selfie_storage_path", "is", null).is("selfie_purged_at", null)
      .not("selfie_uploaded_at", "is", null).lte("selfie_uploaded_at", cutoff)
      .order("selfie_uploaded_at", { ascending: true }).limit(visitLimit),
    client.from("attendance")
      .select("attendance_id,user_id,date,selfie_storage_path,selfie_uploaded_at")
      .not("selfie_storage_path", "is", null).is("selfie_purged_at", null)
      .lte("selfie_uploaded_at", cutoff)
      .order("selfie_uploaded_at", { ascending: true }).limit(attendanceLimit),
  ]);
  if (visits.error) throw new Error(`VISIT_RETENTION_QUERY_FAILED:${visits.error.code ?? "UNKNOWN"}`);
  if (attendance.error) throw new Error(`ATTENDANCE_RETENTION_QUERY_FAILED:${attendance.error.code ?? "UNKNOWN"}`);
  return [
    ...(visits.data ?? []).map((row) => ({ kind: "visit" as const, id: row.visit_id, userId: row.user_id, date: row.visit_date, path: row.selfie_storage_path! })),
    ...(attendance.data ?? []).map((row) => ({ kind: "attendance" as const, id: row.attendance_id, userId: row.user_id, date: row.date, path: row.selfie_storage_path! })),
  ].slice(0, limit);
}

export async function purgeExpiredSelfies(client: SupabaseClient, now = new Date(), limit = SELFIE_RETENTION_BATCH_SIZE): Promise<RetentionResult> {
  const result: RetentionResult = { scanned: 0, deleted: 0, failed: 0, rejected: 0, visitsPurged: 0, attendancePurged: 0 };
  const rows = await candidates(client, retentionCutoff(now), Math.min(Math.max(limit, 1), 1000));
  result.scanned = rows.length;
  for (const candidate of rows) {
    if (!isExactAuthoritativePath(candidate)) { result.rejected++; continue; }
    const table = candidate.kind === "visit" ? "field_visits" : "attendance";
    const idColumn = candidate.kind === "visit" ? "visit_id" : "attendance_id";
    const staleBefore = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const claim = await client.from(table).update({ selfie_purge_state: "purge_pending", selfie_purge_started_at: now.toISOString() })
      .eq(idColumn, candidate.id).eq("selfie_storage_path", candidate.path).is("selfie_purged_at", null)
      .or(`selfie_purge_state.is.null,selfie_purge_state.eq.available,and(selfie_purge_state.eq.purge_pending,selfie_purge_started_at.lt.${staleBefore})`)
      .select(idColumn).maybeSingle();
    if (claim.error || !claim.data) { result.failed++; continue; }
    const removed = await client.storage.from(SELFIE_BUCKET).remove([candidate.path]);
    if (removed.error) { result.failed++; continue; }
    const marked = await client.from(table).update({ selfie_purged_at: now.toISOString(), selfie_purge_state: "purged", selfie_purge_started_at: null })
      .eq(idColumn, candidate.id).eq("selfie_storage_path", candidate.path).is("selfie_purged_at", null)
      .select(idColumn).maybeSingle();
    if (marked.error) { result.failed++; continue; }
    result.deleted++;
    if (candidate.kind === "visit") result.visitsPurged++; else result.attendancePurged++;
  }
  return result;
}
