import type { LocalFieldVisit } from "../db";

export interface OwnVisitMetrics {
  totalVisits: number;
  visitsToday: number;
  waitingToSync: number;
}

export function calculateOwnVisitMetrics(
  userId: string,
  today: string,
  remoteConfirmedCount: number,
  remoteTodayCount: number,
  localVisits: LocalFieldVisit[],
  remotelyConfirmedLocalIds: string[],
): OwnVisitMetrics {
  const retryable = localVisits.filter(
    (visit) => visit.user_id === userId && (visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed"),
  );
  const retryableById = new Map(retryable.map((visit) => [visit.visit_id, visit]));
  const confirmedLocalIds = new Set(remotelyConfirmedLocalIds);
  const localOnly = [...retryableById.values()].filter((visit) => !confirmedLocalIds.has(visit.visit_id));
  return {
    totalVisits: remoteConfirmedCount + localOnly.length,
    visitsToday: remoteTodayCount + localOnly.filter((visit) => visit.visit_date === today).length,
    waitingToSync: localOnly.length,
  };
}
