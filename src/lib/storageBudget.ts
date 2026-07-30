export const KIB = 1024;
export const MIB = 1024 * KIB;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const STORAGE_BUDGET = Object.freeze({
  normalTargetBytes: 50 * MIB,
  warningBytes: 75 * MIB,
  hardLimitBytes: 150 * MIB,
  pendingMediaLimitBytes: 25 * MIB,
  diagnosticLimitBytes: 5 * MIB,
  diagnosticRetentionDays: 7,
  recentOperationalWindowDays: 90,
  visitImageMaxBytes: 350 * KIB,
  visitImageMaxDimension: 1280,
  cleanupBatchSize: 100,
});

export type StorageStatus = "normal" | "warning" | "constrained";

export function storageStatus(bytes: number): StorageStatus {
  if (bytes >= STORAGE_BUDGET.hardLimitBytes) return "constrained";
  if (bytes >= STORAGE_BUDGET.warningBytes) return "warning";
  return "normal";
}

export function operationalCutoff(now = new Date()): string {
  return new Date(now.getTime() - STORAGE_BUDGET.recentOperationalWindowDays * DAY_MS).toISOString();
}

export function estimateRecordBytes(value: unknown): number {
  if (value instanceof Blob) return value.size;
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}
