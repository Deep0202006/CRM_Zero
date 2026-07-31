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
      merged.set(visit.visit_id, { ...visit, sync_status: "synced" });
    }
  }
  return [...merged.values()].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}
