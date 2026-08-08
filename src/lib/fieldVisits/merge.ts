import type { LocalFieldVisit } from "../db";

export function mergeOwnVisits(
  userId: string,
  localVisits: LocalFieldVisit[],
  remoteVisits: LocalFieldVisit[],
): LocalFieldVisit[] {
  const merged = new Map<string, LocalFieldVisit>();
  for (const visit of localVisits) {
    if (visit.user_id === userId) merged.set(visit.visit_id, visit);
  }
  for (const visit of remoteVisits) {
    if (visit.user_id === userId) {
      const local = merged.get(visit.visit_id);
      merged.set(visit.visit_id, {
        ...visit,
        sync_status: "synced",
        sync_stage: local?.sync_stage === "visit_confirmed_evidence_pending" || local?.sync_stage === "visit_confirmed_link_pending" ? local.sync_stage : "synced",
        sync_error_code: local?.sync_error_code,
        sync_error_message: local?.sync_error_message,
        sync_attempt_count: local?.sync_attempt_count,
        last_sync_attempt_at: local?.last_sync_attempt_at,
      });
    }
  }
  return [...merged.values()].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}
