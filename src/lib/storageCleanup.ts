import type Dexie from "dexie";
import type { Table } from "dexie";
import { estimateRecordBytes, operationalCutoff, STORAGE_BUDGET } from "./storageBudget";
import { storageStatus, type StorageStatus } from "./storageBudget";

type Row = Record<string, unknown>;
type QueueRow = {
  table_name: string;
  entity_id?: string;
  data: object;
  status?: string;
};

export interface CleanupDatabase extends Dexie {
  sync_queue: Table<QueueRow, number>;
  call_logs: Table<Row, string>;
  client_queries: Table<Row, string>;
  mapping_requests: Table<Row, string>;
  mappings: Table<Row, string>;
  tasks: Table<Row, string>;
  allocated_targets: Table<Row, string>;
  field_visits: Table<Row, string>;
  field_visit_media: Table<Row, string>;
}

export interface CleanupResult {
  deleted: Record<string, number>;
  reclaimedBytesEstimate: number;
  completedAt: string;
  skipped: boolean;
}

export interface LocalStorageHealth {
  estimatedCrmBytes: number;
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
  tableCounts: Record<string, number>;
  pendingMediaBytes: number;
  pendingQueueCount: number;
  retryWaitCount: number;
  permanentFailureCount: number;
  lastCleanupAt: string | null;
  lastBootstrapAt: string | null;
  status: StorageStatus;
}

const primaryKeys: Record<string, string> = {
  call_logs: "log_id",
  client_queries: "query_id",
  mapping_requests: "request_id",
  mappings: "mapping_id",
  tasks: "task_id",
  allocated_targets: "target_id",
  field_visits: "visit_id",
};

let activeCleanup: Promise<CleanupResult> | null = null;

const belongsToUser = (table: string, row: Row, userId: string) => {
  if (table === "call_logs" || table === "field_visits") return row.user_id === userId;
  if (table === "tasks") return row.assigned_to === userId;
  if (table === "allocated_targets") return row.assigned_to_user_id === userId;
  if (table === "mappings" || table === "mapping_requests") {
    return row.mapped_by === userId || row.requested_by === userId;
  }
  return row.assigned_to === userId || row.resolved_by === userId;
};

const completedOutsideWindow = (table: string, row: Row, cutoff: string) => {
  if (table === "call_logs") return String(row.timestamp ?? "") < cutoff;
  if (table === "field_visits") return String(row.check_in_time ?? "") < cutoff;
  if (table === "client_queries") {
    return row.problem_status === "Resolved" && String(row.resolved_at ?? "") < cutoff;
  }
  if (table === "mapping_requests") return row.status === "Completed" && String(row.completed_at ?? "") < cutoff;
  if (table === "mappings") return String(row.completion_timestamp ?? "") < cutoff;
  if (table === "tasks") return row.status === "Completed" && String(row.completed_at ?? "") < cutoff;
  if (table === "allocated_targets") {
    return (row.is_completed === true || row.is_completed === 1 || row.is_completed === "true")
      && String(row.completed_at ?? "") < cutoff;
  }
  return false;
};

export function isSafelyPrunable(
  table: string,
  row: Row,
  userId: string,
  protectedIds: ReadonlySet<string>,
  cutoff: string,
): boolean {
  const id = String(row[primaryKeys[table]] ?? "");
  return Boolean(row.cache_confirmed_at)
    && belongsToUser(table, row, userId)
    && completedOutsideWindow(table, row, cutoff)
    && !protectedIds.has(id)
    && row.local_mutation_pending !== true
    && row.conflict_unresolved !== true;
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function cleanupInternal(database: CleanupDatabase, userId: string): Promise<CleanupResult> {
  const sessionKey = `storage-cleanup:${userId}`;
  if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(sessionKey)) {
    return { deleted: {}, reclaimedBytesEstimate: 0, completedAt: sessionStorage.getItem(sessionKey)!, skipped: true };
  }

  const queue = await database.sync_queue.toArray();
  const protectedByTable = new Map<string, Set<string>>();
  for (const operation of queue) {
    const key = primaryKeys[operation.table_name] ?? "id";
    const data = operation.data as Row;
    const id = operation.entity_id ?? String(data[key] ?? "");
    const ids = protectedByTable.get(operation.table_name) ?? new Set<string>();
    if (id) ids.add(id);
    protectedByTable.set(operation.table_name, ids);
  }

  const deleted: Record<string, number> = {};
  let reclaimedBytesEstimate = 0;
  const cutoff = operationalCutoff();
  const tables = ["call_logs", "client_queries", "mapping_requests", "mappings", "tasks", "allocated_targets", "field_visits"] as const;

  for (const tableName of tables) {
    const table = database[tableName] as Table<Row, string>;
    let lastKey: string | undefined;
    for (;;) {
      const collection = lastKey === undefined
        ? table.orderBy(":id")
        : table.where(":id").above(lastKey);
      const batch = await collection.limit(STORAGE_BUDGET.cleanupBatchSize).toArray();
      if (batch.length === 0) break;
      lastKey = String(batch[batch.length - 1][primaryKeys[tableName]] ?? "");
      const candidates = batch.filter((row) =>
        isSafelyPrunable(tableName, row, userId, protectedByTable.get(tableName) ?? new Set(), cutoff));
      if (candidates.length) {
        const keys = candidates.map((row) => String(row[primaryKeys[tableName]]));
        await table.bulkDelete(keys);
        deleted[tableName] = (deleted[tableName] ?? 0) + keys.length;
        reclaimedBytesEstimate += candidates.reduce((sum, row) => sum + estimateRecordBytes(row), 0);
      }
      if (batch.length < STORAGE_BUDGET.cleanupBatchSize) break;
      await yieldToBrowser();
    }
  }

  const completedAt = new Date().toISOString();
  if (typeof localStorage !== "undefined") localStorage.setItem(`storage-cleanup:last:${userId}`, completedAt);
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(sessionKey, completedAt);
  return { deleted, reclaimedBytesEstimate, completedAt, skipped: false };
}

export function cleanupLocalStorage(database: CleanupDatabase, userId: string): Promise<CleanupResult> {
  if (!activeCleanup) activeCleanup = cleanupInternal(database, userId).finally(() => { activeCleanup = null; });
  return activeCleanup;
}

export async function getLocalStorageHealth(database: CleanupDatabase, userId: string): Promise<LocalStorageHealth> {
  const tableCounts: Record<string, number> = {};
  let estimatedCrmBytes = 0;
  for (const table of database.tables) {
    const rows = await table.toArray();
    tableCounts[table.name] = rows.length;
    estimatedCrmBytes += rows.reduce((sum, row) => sum + estimateRecordBytes(row), 0);
  }
  const media = await database.field_visit_media.where("user_id").equals(userId).toArray();
  const pendingMediaBytes = media.reduce((sum, row) => {
    const value = row.media_data;
    return sum + (value instanceof Blob ? value.size : 0);
  }, 0);
  const queue = await database.sync_queue.toArray();
  const browserEstimate = typeof navigator !== "undefined" && navigator.storage?.estimate
    ? await navigator.storage.estimate()
    : {};
  return {
    estimatedCrmBytes,
    browserUsageBytes: browserEstimate.usage ?? null,
    browserQuotaBytes: browserEstimate.quota ?? null,
    tableCounts,
    pendingMediaBytes,
    pendingQueueCount: queue.filter((item) => !item.status || item.status === "pending" || item.status === "syncing").length,
    retryWaitCount: queue.filter((item) => item.status === "retry_wait").length,
    permanentFailureCount: queue.filter((item) => item.status === "permanent_failure").length,
    lastCleanupAt: typeof localStorage === "undefined" ? null : localStorage.getItem(`storage-cleanup:last:${userId}`),
    lastBootstrapAt: typeof localStorage === "undefined" ? null : localStorage.getItem(`bootstrap:${userId}:completed`),
    status: storageStatus(estimatedCrmBytes),
  };
}
