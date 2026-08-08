import { createClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { getIstDayBounds } from "@/lib/teamKpi/serverReport";
import { getCanonicalDailyUserMetrics } from "@/lib/workMetrics/canonical";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
function response(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get("authorization") ?? ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!url || !anon || !key || !token) return response(401, { code: "AUTH_REQUIRED" });
  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return response(401, { code: "AUTH_REQUIRED" });
  const [{ data: account }, { data: capabilities }] = await Promise.all([service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle(), service.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id)]);
  if (!account || !active(account.is_active)) return response(403, { code: "ACCOUNT_INACTIVE" });
  const requestUrl = new URL(request.url); const page = Math.max(1, Number.parseInt(requestUrl.searchParams.get("page") ?? "1", 10) || 1);
  const adminScope = requestUrl.searchParams.get("scope") === "admin" && (capabilities ?? []).some((item) => item.capability_code === "admin");
  let historyQuery = service.from("call_logs").select("log_id,user_id,lead_id,client_username,client_name,timestamp,outcome,notes,next_followup_date", { count: "exact" }).order("timestamp", { ascending: false }).order("log_id", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (!adminScope) historyQuery = historyQuery.eq("user_id", auth.user.id);
  const today = getCurrentISTDate(); const { startsAt, endsAt } = getIstDayBounds(today);
  const [history, callsResult, tasksResult, historyResult] = await Promise.all([
    historyQuery,
    service.from("call_logs").select("log_id,user_id,timestamp,outcome,next_followup_date").eq("user_id", auth.user.id).gte("timestamp", startsAt).lt("timestamp", endsAt),
    service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id),
    service.from("task_status_history").select("id,task_id,changed_by,changed_at,new_status").eq("new_status", "Completed").gte("changed_at", startsAt).lt("changed_at", endsAt),
  ]);
  if (history.error || callsResult.error || tasksResult.error || historyResult.error) return response(502, { code: "CALL_HISTORY_FAILED" });
  const metric = getCanonicalDailyUserMetrics({ userId: auth.user.id, calls: callsResult.data ?? [], tasks: tasksResult.data ?? [], taskHistory: historyResult.data ?? [] });
  const confirmedReachedCallIds = (callsResult.data ?? []).filter((call) => metric.genuine_call_ids.has(call.log_id) && !call.outcome.toLowerCase().includes("no response")).map((call) => call.log_id);
  return response(200, { calls: history.data ?? [], page, page_size: PAGE_SIZE, total: history.count ?? 0, has_more: page * PAGE_SIZE < (history.count ?? 0), confirmed_genuine_call_ids: [...metric.genuine_call_ids], confirmed_followup_call_ids: [...metric.followup_call_ids], confirmed_reached_call_ids: [...new Set(confirmedReachedCallIds)] });
}
