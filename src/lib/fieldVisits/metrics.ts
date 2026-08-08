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
  const ownById = new Map(localVisits.filter((visit) => visit.user_id === userId).map((visit) => [visit.visit_id, visit]));
  const confirmedLocalIds = new Set(remotelyConfirmedLocalIds);
  const localOnly = [...ownById.values()].filter((visit) => !confirmedLocalIds.has(visit.visit_id));
  const waitingToSync = localOnly.filter((visit) => visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed").length;
  return {
    totalVisits: remoteConfirmedCount + localOnly.length,
    visitsToday: remoteTodayCount + localOnly.filter((visit) => visit.visit_date === today).length,
    waitingToSync,
  };
}
