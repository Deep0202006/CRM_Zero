import {
  getCanonicalDailyUserMetrics,
  type CanonicalCallLog,
  type CanonicalTask,
  type CanonicalTaskHistory,
} from "@/lib/workMetrics/canonical";

const PAGE_SIZE = 100;
type HistoryCall = CanonicalCallLog & { lead_id?: string | null; client_username?: string | null; client_name?: string | null; notes?: string | null };
type QueryResult<T> = { data: T[] | null; error: unknown; count?: number | null };

export interface CallHistoryDependencies {
  history: () => PromiseLike<QueryResult<HistoryCall>>;
  todayCalls: () => PromiseLike<QueryResult<CanonicalCallLog>>;
  tasks: () => PromiseLike<QueryResult<CanonicalTask>>;
  taskHistory: () => PromiseLike<QueryResult<CanonicalTaskHistory>>;
}

function response(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function historyBody(history: QueryResult<HistoryCall>, page: number) {
  return {
    calls: history.data ?? [],
    page,
    page_size: PAGE_SIZE,
    total: history.count ?? 0,
    has_more: page * PAGE_SIZE < (history.count ?? 0),
  };
}

export async function loadCallHistoryWithOptionalMetrics(dependencies: CallHistoryDependencies, userId: string, page: number): Promise<Response> {
  let history: QueryResult<HistoryCall>;
  try {
    history = await dependencies.history();
  } catch {
    console.error("Authoritative call history query failed", { source: "call_logs", code: "query_rejected" });
    return response(502, { code: "CALL_HISTORY_FAILED" });
  }
  if (history.error) {
    console.error("Authoritative call history query failed", { source: "call_logs", code: (history.error as { code?: string })?.code ?? "unknown" });
    return response(502, { code: "CALL_HISTORY_FAILED" });
  }

  const base = historyBody(history, page);
  const [callsSettled, tasksSettled, taskHistorySettled] = await Promise.allSettled([
    dependencies.todayCalls(),
    dependencies.tasks(),
    dependencies.taskHistory(),
  ]);
  const callsResult = callsSettled.status === "fulfilled" ? callsSettled.value : { data: null, error: { code: "query_rejected" } };
  const tasksResult = tasksSettled.status === "fulfilled" ? tasksSettled.value : { data: null, error: { code: "query_rejected" } };
  const taskHistoryResult = taskHistorySettled.status === "fulfilled" ? taskHistorySettled.value : { data: null, error: { code: "query_rejected" } };
  const metricSourcesHealthy = !callsResult.error && !tasksResult.error && !taskHistoryResult.error;
  if (!metricSourcesHealthy) {
    console.warn("Call history metric enrichment degraded", {
      todayCalls: callsResult.error ? "unavailable" : "available",
      tasks: tasksResult.error ? "unavailable" : "available",
      taskHistory: taskHistoryResult.error ? "unavailable" : "available",
    });
  }
  if (callsResult.error) return response(200, { ...base, metrics_authoritative: false, metric_warning: "CALL_METRICS_DEGRADED" });

  try {
    const metric = getCanonicalDailyUserMetrics({
      userId,
      calls: callsResult.data ?? [],
      tasks: tasksResult.data ?? [],
      taskHistory: taskHistoryResult.data ?? [],
    });
    const confirmedReachedCallIds = (callsResult.data ?? [])
      .filter((call) => metric.genuine_call_ids.has(call.log_id) && !(call.outcome ?? "").toLowerCase().includes("no response"))
      .map((call) => call.log_id);
    return response(200, {
      ...base,
      metrics_authoritative: metricSourcesHealthy,
      ...(!metricSourcesHealthy ? { metric_warning: "CALL_METRICS_DEGRADED" } : {}),
      confirmed_genuine_call_ids: [...metric.genuine_call_ids],
      confirmed_followup_call_ids: [...metric.followup_call_ids],
      confirmed_reached_call_ids: [...new Set(confirmedReachedCallIds)],
    });
  } catch {
    return response(200, { ...base, metrics_authoritative: false, metric_warning: "CALL_METRICS_DEGRADED" });
  }
}
