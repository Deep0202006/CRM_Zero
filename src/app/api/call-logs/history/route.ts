import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { getIstDayBounds } from "@/lib/teamKpi/serverReport";
import { getCanonicalDailyUserMetrics, type CanonicalCallLog, type CanonicalTask, type CanonicalTaskHistory } from "@/lib/workMetrics/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function active(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function historyBody(history: QueryResult<HistoryCall>, page: number) {
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

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!url || !anon || !key || !token) return response(401, { code: "AUTH_REQUIRED" });

  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const service: SupabaseClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return response(401, { code: "AUTH_REQUIRED" });

  const [{ data: account, error: accountError }, { data: capabilities, error: capabilityError }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id),
  ]);
  if (accountError || !account || !active(account.is_active)) return response(403, { code: "ACCOUNT_INACTIVE" });

  const requestUrl = new URL(request.url);
  const page = Math.max(1, Number.parseInt(requestUrl.searchParams.get("page") ?? "1", 10) || 1);
  const requestedAdminScope = requestUrl.searchParams.get("scope") === "admin";
  if (requestedAdminScope && capabilityError) return response(503, { code: "CAPABILITY_CHECK_FAILED" });
  const adminScope = requestedAdminScope && (capabilities ?? []).some((item) => item.capability_code === "admin");
  let historyQuery = service
    .from("call_logs")
    .select("log_id,user_id,lead_id,client_username,client_name,timestamp,outcome,notes,next_followup_date", { count: "exact" })
    .order("timestamp", { ascending: false })
    .order("log_id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (!adminScope) historyQuery = historyQuery.eq("user_id", auth.user.id);

  const today = getCurrentISTDate();
  const { startsAt, endsAt } = getIstDayBounds(today);
  return loadCallHistoryWithOptionalMetrics({
    history: () => historyQuery,
    todayCalls: () => service.from("call_logs").select("log_id,user_id,timestamp,outcome,next_followup_date").eq("user_id", auth.user.id).gte("timestamp", startsAt).lt("timestamp", endsAt),
    tasks: () => service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id),
    taskHistory: () => service.from("task_status_history").select("id,task_id,changed_by,changed_at,new_status").eq("new_status", "Completed").gte("changed_at", startsAt).lt("changed_at", endsAt),
  }, auth.user.id, page);
}
