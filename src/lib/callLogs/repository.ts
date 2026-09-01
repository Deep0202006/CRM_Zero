import { db, LocalCallLog } from "../db";
import { isSupabaseConfigured, supabase } from "../supabaseClient";

export const CALL_LOGS_CHANGED_EVENT = "zerodata:call-logs-changed";

export function formatCallHistoryCount(input: { authoritative: boolean; lifetimeConfirmedTotal: number | null; pendingCount: number; loadedCount: number }): string {
  const pending = input.pendingCount > 0 ? ` · ${input.pendingCount} pending sync` : "";
  if (input.authoritative && input.lifetimeConfirmedTotal !== null) {
    const noun = input.lifetimeConfirmedTotal === 1 ? "record" : "records";
    return `${input.lifetimeConfirmedTotal} lifetime confirmed ${noun}${pending} · showing latest ${input.loadedCount}`;
  }
  const noun = input.loadedCount === 1 ? "record" : "records";
  return `${input.loadedCount} ${noun} available on this device${pending}`;
}

export interface CallLogSnapshot {
  logs: LocalCallLog[];
  confirmedLogs: LocalCallLog[];
  lifetimeConfirmedTotal: number | null;
  pendingCount: number;
  authoritative: boolean;
  metricsAuthoritative: boolean;
  notice: string | null;
  confirmedGenuineCallIds: string[];
  confirmedFollowupCallIds: string[];
  confirmedReachedCallIds: string[];
  page: number;
  hasMore: boolean;
}

function belongsToUser(log: LocalCallLog, userId: string, isAdmin: boolean): boolean {
  return isAdmin || log.user_id === userId;
}

function sortNewestFirst(logs: LocalCallLog[]): LocalCallLog[] {
  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function mergeConfirmedAndPendingCalls(confirmedLogs: LocalCallLog[], pendingLogs: LocalCallLog[]): LocalCallLog[] {
  const merged = new Map(confirmedLogs.map((log) => [log.log_id, log]));
  for (const pending of pendingLogs) merged.set(pending.log_id, pending);
  return sortNewestFirst([...merged.values()]);
}

async function localSnapshot(userId: string, isAdmin: boolean, notice: string | null): Promise<CallLogSnapshot> {
  const localLogs = isAdmin
    ? await db.call_logs.toArray()
    : await db.call_logs.where("user_id").equals(userId).toArray();
  const pendingRows = await db.sync_queue
    .filter((item) => item.table_name === "call_logs" && (item.action === "INSERT" || item.action === "UPDATE"))
    .toArray();
  const localById = new Map(localLogs.map((log) => [log.log_id, log]));
  const pendingIds = new Set(pendingRows
    .map((item) => (item.data as Partial<LocalCallLog>).log_id)
    .filter((id): id is string => Boolean(id && localById.has(id)))
    .filter((id) => belongsToUser(localById.get(id)!, userId, isAdmin)));

  return {
    logs: sortNewestFirst(localLogs),
    confirmedLogs: sortNewestFirst(localLogs.filter((log) => !pendingIds.has(log.log_id))),
    lifetimeConfirmedTotal: null,
    pendingCount: pendingIds.size,
    authoritative: false,
    metricsAuthoritative: false,
    notice,
    confirmedGenuineCallIds: [],
    confirmedFollowupCallIds: [],
    confirmedReachedCallIds: [],
    page: 1,
    hasMore: false,
  };
}

export async function fetchCallLogSnapshot(userId: string, isAdmin: boolean, page = 1): Promise<CallLogSnapshot> {
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    return localSnapshot(userId, isAdmin, "Offline: showing durable calls saved on this device. Confirmed history will reconcile after reconnecting.");
  }

  const pendingRows = await db.sync_queue
    .filter((item) => item.table_name === "call_logs" && (item.action === "INSERT" || item.action === "UPDATE"))
    .toArray();
  const pendingIds = [...new Set(pendingRows.map((item) => (item.data as Partial<LocalCallLog>).log_id).filter((id): id is string => Boolean(id)))];
  const pendingLogs = (await db.call_logs.bulkGet(pendingIds))
    .filter((log): log is LocalCallLog => Boolean(log))
    .filter((log) => belongsToUser(log, userId, isAdmin));

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Authentication required");
    const response = await fetch(`/api/call-logs/history?page=${page}${isAdmin ? "&scope=admin" : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json() as { calls?: LocalCallLog[]; total?: number; metrics_authoritative?: boolean; metric_warning?: string; confirmed_genuine_call_ids?: string[]; confirmed_followup_call_ids?: string[]; confirmed_reached_call_ids?: string[]; has_more?: boolean };
    if (!response.ok) throw new Error("Call history could not be confirmed.");
    const confirmedLogs = result.calls ?? [];

    if (confirmedLogs.length > 0) await db.call_logs.bulkPut(confirmedLogs);

    const unsyncedLogs = pendingLogs;

    return {
      logs: mergeConfirmedAndPendingCalls(confirmedLogs, unsyncedLogs),
      confirmedLogs: sortNewestFirst(confirmedLogs),
      lifetimeConfirmedTotal: typeof result.total === "number" ? result.total : null,
      pendingCount: unsyncedLogs.length,
      authoritative: true,
      metricsAuthoritative: result.metrics_authoritative !== false,
      notice: result.metrics_authoritative === false ? "Confirmed call history is current. Today's derived call metrics are temporarily unavailable." : null,
      confirmedGenuineCallIds: result.confirmed_genuine_call_ids ?? [],
      confirmedFollowupCallIds: result.confirmed_followup_call_ids ?? [],
      confirmedReachedCallIds: result.confirmed_reached_call_ids ?? [],
      page,
      hasMore: Boolean(result.has_more),
    };
  } catch (error) {
    console.warn("Authoritative call-log refresh failed; using the offline snapshot:", error);
    return localSnapshot(userId, isAdmin, "Confirmed call history could not be refreshed. Showing durable calls saved on this device; retry to reconcile server records.");
  }
}
