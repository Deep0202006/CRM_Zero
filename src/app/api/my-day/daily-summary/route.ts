import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { getIstDayBounds, loadTeamKpiServerReport } from "@/lib/teamKpi/serverReport";
import { getCanonicalDailyUserMetrics } from "@/lib/workMetrics/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function error(status: number, code: string, message: string) { return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t"].includes(value.toLowerCase())); }

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) return error(500, "SUPABASE_NOT_CONFIGURED", "Daily summary server access is not configured.");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return error(401, "AUTHENTICATION_REQUIRED", "Sign in again to view My Day.");
  const token = authorization.slice(7).trim();
  const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user) return error(401, "AUTHENTICATION_REQUIRED", "Your session has expired. Sign in again.");
  const { data: profile } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (!profile || !active(profile.is_active)) return error(403, "ACTIVE_ACCOUNT_REQUIRED", "An active account is required.");
  const date = getCurrentISTDate();
  const { startsAt, endsAt } = getIstDayBounds(date);
  try {
    const [report, callsResult, completedTasksResult, pendingTasksResult, historyResult] = await Promise.all([
      loadTeamKpiServerReport(service, date),
      service.from("call_logs").select("log_id,user_id,timestamp,outcome,next_followup_date").eq("user_id", auth.user.id).gte("timestamp", startsAt).lt("timestamp", endsAt),
      service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).eq("status", "Completed").gte("completed_at", startsAt).lt("completed_at", endsAt),
      service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).neq("status", "Completed"),
      service.from("task_status_history").select("id,task_id,changed_by,changed_at,new_status").eq("new_status", "Completed").gte("changed_at", startsAt).lt("changed_at", endsAt),
    ]);
    if (callsResult.error || completedTasksResult.error || pendingTasksResult.error || historyResult.error) throw callsResult.error ?? completedTasksResult.error ?? pendingTasksResult.error ?? historyResult.error;
    const historyTaskIds = [...new Set((historyResult.data ?? []).map((item) => item.task_id))];
    const historyTasksResult = historyTaskIds.length
      ? await service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).in("task_id", historyTaskIds)
      : { data: [], error: null };
    if (historyTasksResult.error) throw historyTasksResult.error;
    const taskMap = new Map([...completedTasksResult.data ?? [], ...pendingTasksResult.data ?? [], ...historyTasksResult.data ?? []].map((task) => [task.task_id, task]));
    const metric = getCanonicalDailyUserMetrics({ userId: auth.user.id, calls: callsResult.data ?? [], tasks: [...taskMap.values()], taskHistory: historyResult.data ?? [] });
    const row = report.rows.find((item) => item.user_id === auth.user.id);
    return NextResponse.json({
      genuine_calls_today: metric.genuine_call_ids.size,
      confirmed_genuine_call_ids: [...metric.genuine_call_ids],
      normal_tasks_completed_today: metric.completed_task_ids.size - metric.followup_task_ids.size,
      followup_tasks_completed_today: metric.followup_task_ids.size,
      total_tasks_completed_today: (row?.tasks_completed ?? metric.completed_task_ids.size),
      pending_followups: metric.pending_followups,
      unique_completed_work: row?.total_completed_work ?? metric.unique_work_keys.size,
      generated_at: report.generated_at,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (caught) {
    console.error("Canonical My Day summary failed", caught);
    return error(502, "MY_DAY_SUMMARY_FAILED", "Confirmed daily work could not be loaded.");
  }
}
