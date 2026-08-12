import type { SupabaseClient } from "@supabase/supabase-js";
import { attendanceEvidencePath, isExactAuthoritativePath, SELFIE_BUCKET } from "./retention";
import { generateEvidencePath } from "./contract";

export const INITIAL_PURGE_CUTOFF_IST = "2026-08-11 23:59:59 Asia/Kolkata";
export const INITIAL_PURGE_CUTOFF_UTC = "2026-08-11T18:29:59.000Z";
type StorageCandidate = { kind: "visit" | "attendance"; id: string; userId: string; date: string; path: string };
export interface InitialPurgeResult { dryRun: boolean; eligibleVisitStorage: number; eligibleLegacyAttendance: number; eligibleAttendanceStorage: number; eligibleStorageObjects: number; estimatedBytes: number; metadataRecords: number; unrelatedObjectsSelected: number; visitObjectsRemoved: number; attendanceObjectsRemoved: number; legacyAttendanceCleared: number; failures: number; }

async function exactObjectBytes(client: SupabaseClient, path: string): Promise<{ exists: boolean; bytes: number }> {
  const slash = path.lastIndexOf("/");
  const directory = path.slice(0, slash), filename = path.slice(slash + 1);
  const listed = await client.storage.from(SELFIE_BUCKET).list(directory, { search: filename, limit: 10 });
  if (listed.error) throw new Error("INITIAL_PURGE_STORAGE_PROVENANCE_FAILED");
  const exact = (listed.data ?? []).find((item) => item.name === filename);
  return { exists: Boolean(exact), bytes: Number(exact?.metadata?.size ?? 0) };
}

export async function runInitialEvidencePurge(client: SupabaseClient, dryRun: boolean): Promise<InitialPurgeResult> {
  const result: InitialPurgeResult = { dryRun, eligibleVisitStorage: 0, eligibleLegacyAttendance: 0, eligibleAttendanceStorage: 0, eligibleStorageObjects: 0, estimatedBytes: 0, metadataRecords: 0, unrelatedObjectsSelected: 0, visitObjectsRemoved: 0, attendanceObjectsRemoved: 0, legacyAttendanceCleared: 0, failures: 0 };
  const [visits, attendanceStorage, legacyAttendance] = await Promise.all([
    client.from("field_visits").select("visit_id,user_id,visit_date,selfie_storage_path,selfie_uploaded_at,selfie_captured_at,created_at,selfie_purged_at").not("selfie_storage_path", "is", null).is("selfie_purged_at", null).or(`selfie_uploaded_at.lte.${INITIAL_PURGE_CUTOFF_UTC},and(selfie_uploaded_at.is.null,selfie_captured_at.lte.${INITIAL_PURGE_CUTOFF_UTC}),and(selfie_uploaded_at.is.null,selfie_captured_at.is.null,created_at.lte.${INITIAL_PURGE_CUTOFF_UTC})`).limit(1000),
    client.from("attendance").select("attendance_id,user_id,date,selfie_storage_path,selfie_uploaded_at,selfie_purged_at").not("selfie_storage_path", "is", null).is("selfie_purged_at", null).lte("selfie_uploaded_at", INITIAL_PURGE_CUTOFF_UTC).limit(1000),
    client.from("attendance").select("attendance_id,user_id,date,clock_in,selfie_url,selfie_purged_at").like("selfie_url", "data:image/%").is("selfie_purged_at", null).lte("clock_in", INITIAL_PURGE_CUTOFF_UTC).limit(1000),
  ]);
  if (visits.error || attendanceStorage.error || legacyAttendance.error) throw new Error("INITIAL_PURGE_QUERY_FAILED");
  const storage: StorageCandidate[] = [
    ...(visits.data ?? []).map((row) => ({ kind: "visit" as const, id: row.visit_id, userId: row.user_id, date: row.visit_date, path: row.selfie_storage_path! })),
    ...(attendanceStorage.data ?? []).map((row) => ({ kind: "attendance" as const, id: row.attendance_id, userId: row.user_id, date: row.date, path: row.selfie_storage_path! })),
  ];
  result.eligibleVisitStorage = visits.data?.length ?? 0;
  result.eligibleAttendanceStorage = attendanceStorage.data?.length ?? 0;
  result.eligibleLegacyAttendance = legacyAttendance.data?.length ?? 0;
  result.estimatedBytes += (legacyAttendance.data ?? []).reduce((sum, row) => sum + Math.floor(String(row.selfie_url ?? "").length * 0.75), 0);
  for (const candidate of storage) {
    const expected = candidate.kind === "visit" ? generateEvidencePath(candidate.userId, candidate.date, candidate.id) : attendanceEvidencePath(candidate.userId, candidate.date, candidate.id);
    if (candidate.path !== expected || !isExactAuthoritativePath(candidate)) { result.unrelatedObjectsSelected++; continue; }
    const provenance = await exactObjectBytes(client, candidate.path);
    if (provenance.exists) { result.eligibleStorageObjects++; result.estimatedBytes += provenance.bytes; }
    result.metadataRecords++;
    if (dryRun) continue;
    const table = candidate.kind === "visit" ? "field_visits" : "attendance", idColumn = candidate.kind === "visit" ? "visit_id" : "attendance_id";
    const pending = await client.from(table).update({ selfie_purge_state: "purge_pending", selfie_purge_started_at: new Date().toISOString() }).eq(idColumn, candidate.id).eq("selfie_storage_path", candidate.path).is("selfie_purged_at", null).select(idColumn).maybeSingle();
    if (pending.error || !pending.data) { result.failures++; continue; }
    const removed = await client.storage.from(SELFIE_BUCKET).remove([candidate.path]);
    if (removed.error) { result.failures++; continue; }
    const marked = await client.from(table).update({ selfie_purged_at: new Date().toISOString(), selfie_purge_state: "purged", selfie_purge_started_at: null }).eq(idColumn, candidate.id).eq("selfie_storage_path", candidate.path).is("selfie_purged_at", null).select(idColumn).maybeSingle();
    if (marked.error || !marked.data) { result.failures++; continue; }
    if (candidate.kind === "visit") result.visitObjectsRemoved++; else result.attendanceObjectsRemoved++;
  }
  for (const row of legacyAttendance.data ?? []) {
    result.metadataRecords++;
    if (dryRun) continue;
    const cleared = await client.from("attendance").update({ selfie_url: null, selfie_captured: true, selfie_purged_at: new Date().toISOString(), selfie_purge_state: "purged", selfie_purge_started_at: null }).eq("attendance_id", row.attendance_id).eq("user_id", row.user_id).eq("date", row.date).eq("clock_in", row.clock_in).like("selfie_url", "data:image/%").is("selfie_purged_at", null).select("attendance_id").maybeSingle();
    if (cleared.error || !cleared.data) result.failures++; else result.legacyAttendanceCleared++;
  }
  return result;
}
