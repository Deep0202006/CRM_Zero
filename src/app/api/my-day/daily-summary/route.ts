import { NextRequest, NextResponse } from "next/server";
import { getCurrentISTDate } from "@/lib/dateTime";
import { createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { getIstDayBounds, loadTeamKpiServerReport } from "@/lib/teamKpi/serverReport";
import { getCanonicalDailyUserMetrics } from "@/lib/workMetrics/canonical";
import { isValidSelfScheduledFollowUp } from "@/lib/followUps";
import type { LocalTask } from "@/lib/db";
import { classifyTaskFocus } from "@/lib/pipeline/salesReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function error(status: number, code: string, message: string) { return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t"].includes(value.toLowerCase())); }

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return error(401, "AUTHENTICATION_REQUIRED", "Sign in again to view My Day.");
  const token = authorization.slice(7).trim();
  const userResult = createServerAnonClient(token), serviceResult = createServerServiceClient();
  if (!userResult.ok || !serviceResult.ok) return error(503, "SUPABASE_NOT_CONFIGURED", "Daily summary server access is not configured.");
  const userClient = userResult.client, service = serviceResult.client;
  const { data: auth, error: authError } = await userClient.auth.getUser(token);
  if (authError || !auth.user) return error(401, "AUTHENTICATION_REQUIRED", "Your session has expired. Sign in again.");
  const { data: profile } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (!profile || !active(profile.is_active)) return error(403, "ACTIVE_ACCOUNT_REQUIRED", "An active account is required.");
  const date = getCurrentISTDate();
  const { startsAt, endsAt } = getIstDayBounds(date);
  try {
    const [report, callsResult, completedTasksResult, pendingTasksResult, historyResult, ownedLeadsResult] = await Promise.all([
      loadTeamKpiServerReport(service, date),
      service.from("call_logs").select("log_id,user_id,timestamp,outcome,next_followup_date").eq("user_id", auth.user.id).gte("timestamp", startsAt).lt("timestamp", endsAt),
      service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).eq("is_active", true).eq("status", "Completed").gte("completed_at", startsAt).lt("completed_at", endsAt),
      service.from("tasks").select("task_id,assigned_to,assigned_by,title,priority,due_date,related_lead_id,created_at,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).eq("is_active", true).neq("status", "Completed").order("due_date", { ascending: true }).order("task_id", { ascending: true }).limit(50),
      service.from("task_status_history").select("id,task_id,changed_by,changed_at,new_status").eq("new_status", "Completed").gte("changed_at", startsAt).lt("changed_at", endsAt),
      service.from("leads").select("lead_id,business_name,status,created_at,stage_entered_at").eq("assigned_to", auth.user.id).order("stage_entered_at", { ascending: false }).order("lead_id", { ascending: false }).limit(50),
    ]);
    if (callsResult.error || completedTasksResult.error || pendingTasksResult.error || historyResult.error || ownedLeadsResult.error) throw callsResult.error ?? completedTasksResult.error ?? pendingTasksResult.error ?? historyResult.error ?? ownedLeadsResult.error;
    const historyTaskIds = [...new Set((historyResult.data ?? []).map((item) => item.task_id))];
    const historyTasksResult = historyTaskIds.length
      ? await service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).eq("is_active", true).in("task_id", historyTaskIds)
      : { data: [], error: null };
    if (historyTasksResult.error) throw historyTasksResult.error;
    const taskMap = new Map([...completedTasksResult.data ?? [], ...pendingTasksResult.data ?? [], ...historyTasksResult.data ?? []].map((task) => [task.task_id, task]));
    const metric = getCanonicalDailyUserMetrics({ userId: auth.user.id, calls: callsResult.data ?? [], tasks: [...taskMap.values()], taskHistory: historyResult.data ?? [] });
    const row = report.rows.find((item) => item.user_id === auth.user.id);
    const ownedLeadIds = (ownedLeadsResult.data ?? []).map((lead) => lead.lead_id);
    const recentCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const recentTransitionsResult = ownedLeadIds.length
      ? await service.from("pipeline_transition_operations").select("lead_id,expected_stage,target_stage,confirmed_at").in("lead_id", ownedLeadIds).gte("confirmed_at", recentCutoff).order("confirmed_at", { ascending: false }).limit(100)
      : { data: [], error: null };
    if (recentTransitionsResult.error) throw recentTransitionsResult.error;
    const latestTransition = new Map<string, { confirmed_at: string; expected_stage: string; target_stage: string }>();
    for (const transition of recentTransitionsResult.data ?? []) if (!latestTransition.has(transition.lead_id)) latestTransition.set(transition.lead_id, transition);
    const pendingTasks = pendingTasksResult.data ?? [];
    const linkedLeadIds = new Set(pendingTasks.map((task) => task.related_lead_id).filter(Boolean));
    const focusSignals: Array<{ id: string; kind: "task" | "lead"; title: string; due_date: string | null; related_lead_id: string | null; priority: "P0" | "P1" | "P2"; reason_code: string; reason: string }> = pendingTasks.map((task) => ({
      id: `task:${task.task_id}`,
      kind: "task" as const,
      title: task.title,
      due_date: task.due_date,
      related_lead_id: task.related_lead_id,
      ...classifyTaskFocus(task, date, isValidSelfScheduledFollowUp(task as LocalTask, auth.user.id)),
    }));
    for (const lead of ownedLeadsResult.data ?? []) {
      const stageAgeDays = Math.max(0, Math.floor((Date.now() - Date.parse(lead.stage_entered_at ?? lead.created_at)) / 86_400_000));
      const transition = latestTransition.get(lead.lead_id);
      if (stageAgeDays >= 14) focusSignals.push({ id: `lead:${lead.lead_id}:stale`, kind: "lead", title: lead.business_name, due_date: null, related_lead_id: lead.lead_id, priority: "P1", reason_code: "STALE_STAGE", reason: `${lead.status} stage is ${stageAgeDays} days old` });
      else if (transition) focusSignals.push({ id: `lead:${lead.lead_id}:movement`, kind: "lead", title: lead.business_name, due_date: null, related_lead_id: lead.lead_id, priority: "P2", reason_code: "RECENT_STAGE_MOVEMENT", reason: `${transition.expected_stage} changed to ${transition.target_stage}` });
      else if (!linkedLeadIds.has(lead.lead_id)) focusSignals.push({ id: `lead:${lead.lead_id}:no-task`, kind: "lead", title: lead.business_name, due_date: null, related_lead_id: lead.lead_id, priority: "P2", reason_code: "NO_EXACT_NEXT_TASK", reason: "No exact linked next task" });
    }
    const priorityOrder = { P0: 0, P1: 1, P2: 2 } as const;
    focusSignals.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority] || String(left.due_date ?? "9999").localeCompare(String(right.due_date ?? "9999")) || left.id.localeCompare(right.id));
    return NextResponse.json({
      genuine_calls_today: metric.genuine_call_ids.size,
      confirmed_genuine_call_ids: [...metric.genuine_call_ids],
      confirmed_followup_call_ids: [...metric.followup_call_ids],
      followup_calls_today: metric.followup_call_ids.size,
      normal_tasks_completed_today: metric.completed_task_ids.size - metric.followup_task_ids.size,
      followup_tasks_completed_today: metric.followup_task_ids.size,
      total_tasks_completed_today: (row?.tasks_completed ?? metric.completed_task_ids.size),
      pending_followups: metric.pending_followups,
      unique_completed_work: row?.total_completed_work ?? metric.unique_work_keys.size,
      focus_signals: focusSignals.slice(0, 50),
      focus_limit: 50,
      generated_at: report.generated_at,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (caught) {
    console.error("Canonical My Day summary failed", caught);
    return error(502, "MY_DAY_SUMMARY_FAILED", "Confirmed daily work could not be loaded.");
  }
}
