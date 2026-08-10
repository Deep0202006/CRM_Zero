import type { SyncQueueItem } from "../db";

export const LEGACY_PIPELINE_STATUS_ERROR = "LEGACY_PIPELINE_STATUS_REQUIRES_RECONCILIATION";

export function isPassiveRecoveryEvidence(item: Pick<SyncQueueItem, "recovery_state">): boolean {
  return Boolean(item.recovery_state);
}

export function isActiveSyncQueueItem(item: Pick<SyncQueueItem, "recovery_state">): boolean {
  return !isPassiveRecoveryEvidence(item);
}

export function isLegacyPipelineStatusMutation(item: Pick<SyncQueueItem, "table_name" | "action" | "data">): boolean {
  if (item.table_name !== "leads" || item.action !== "UPDATE" || !item.data || typeof item.data !== "object") return false;
  return Object.prototype.hasOwnProperty.call(item.data, "status");
}

export function preserveLegacyNonStatusUpdate(item: SyncQueueItem): { originalData: Record<string, unknown>; replayData: Record<string, unknown> | null } {
  const data = { ...(item.data as Record<string, unknown>) };
  if (data.__pipeline_non_status_requeued === true) return { originalData: data, replayData: null };
  const replayData = { ...data };
  delete replayData.status;
  delete replayData.__pipeline_non_status_requeued;
  data.__pipeline_non_status_requeued = true;
  return { originalData: data, replayData: Object.keys(replayData).some((key) => key !== "lead_id") ? replayData : null };
}
