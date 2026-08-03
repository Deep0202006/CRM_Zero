import { db, LocalCallLog } from "../db";
import { isSupabaseConfigured, supabase } from "../supabaseClient";

export const CALL_LOGS_CHANGED_EVENT = "zerodata:call-logs-changed";

export interface CallLogSnapshot {
  logs: LocalCallLog[];
  confirmedLogs: LocalCallLog[];
  confirmedCount: number;
  pendingCount: number;
  authoritative: boolean;
}

function belongsToUser(log: LocalCallLog, userId: string, isAdmin: boolean): boolean {
  return isAdmin || log.user_id === userId;
}

function sortNewestFirst(logs: LocalCallLog[]): LocalCallLog[] {
  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function localSnapshot(userId: string, isAdmin: boolean): Promise<CallLogSnapshot> {
  const localLogs = isAdmin
    ? await db.call_logs.toArray()
    : await db.call_logs.where("user_id").equals(userId).toArray();
  const pendingRows = await db.sync_queue
    .filter((item) => item.table_name === "call_logs" && item.action === "INSERT")
    .toArray();
  const pendingIds = new Set(
    pendingRows
      .map((item) => item.data as LocalCallLog)
      .filter((log) => belongsToUser(log, userId, isAdmin))
      .map((log) => log.log_id),
  );

  return {
    logs: sortNewestFirst(localLogs),
    confirmedLogs: sortNewestFirst(localLogs.filter((log) => !pendingIds.has(log.log_id))),
    confirmedCount: localLogs.filter((log) => !pendingIds.has(log.log_id)).length,
    pendingCount: pendingIds.size,
    authoritative: false,
  };
}

export async function fetchCallLogSnapshot(userId: string, isAdmin: boolean): Promise<CallLogSnapshot> {
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    return localSnapshot(userId, isAdmin);
  }

  const pendingRows = await db.sync_queue
    .filter((item) => item.table_name === "call_logs" && item.action === "INSERT")
    .toArray();
  const pendingLogs = pendingRows
    .map((item) => item.data as LocalCallLog)
    .filter((log) => belongsToUser(log, userId, isAdmin));

  try {
    const confirmedLogs: LocalCallLog[] = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      let query = supabase
        .from("call_logs")
        .select("*")
        .order("log_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (!isAdmin) query = query.eq("user_id", userId);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const page = (data ?? []) as LocalCallLog[];
      confirmedLogs.push(...page);
      if (page.length < pageSize) break;
    }

    if (confirmedLogs.length > 0) await db.call_logs.bulkPut(confirmedLogs);

    const confirmedIds = new Set(confirmedLogs.map((log) => log.log_id));
    const unsyncedLogs = pendingLogs.filter((log) => !confirmedIds.has(log.log_id));

    return {
      logs: sortNewestFirst([...confirmedLogs, ...unsyncedLogs]),
      confirmedLogs: sortNewestFirst(confirmedLogs),
      confirmedCount: confirmedLogs.length,
      pendingCount: unsyncedLogs.length,
      authoritative: true,
    };
  } catch (error) {
    console.warn("Authoritative call-log refresh failed; using the offline snapshot:", error);
    return localSnapshot(userId, isAdmin);
  }
}
