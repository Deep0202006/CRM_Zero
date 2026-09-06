import { isCallLeadId } from "@/lib/callLogs/contract";
import { canReadLinkedWork } from "@/lib/pipeline/salesReview";
import { createPipelineServerContext } from "../../../server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const context = await createPipelineServerContext(request);
  if (context instanceof Response) return context;
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  const { leadId } = await params;
  if (!isCallLeadId(leadId)) return Response.json({ code: "PIPELINE_INVALID_LEAD" }, { status: 400 });

  const leadResult = await context.service.from("leads").select("lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,lead_source,area").eq("lead_id", leadId).maybeSingle();
  if (leadResult.error) return Response.json({ code: "PIPELINE_CONTEXT_FAILED" }, { status: 502 });
  if (!leadResult.data) return Response.json({ code: "PIPELINE_LEAD_NOT_FOUND" }, { status: 404 });

  const capabilityResult = await context.service.from("user_capabilities").select("capability_code").eq("user_id", context.userId);
  if (capabilityResult.error) return Response.json({ code: "PIPELINE_CONTEXT_AUTHORIZATION_FAILED" }, { status: 503 });
  const isAdmin = (capabilityResult.data ?? []).some((item) => item.capability_code === "admin");
  let tasksQuery = context.service.from("tasks").select("task_id,title,priority,status,due_date,completed_at,created_at,assigned_to").eq("related_lead_id", leadId).eq("is_active", true).order("due_date", { ascending: true }).order("task_id", { ascending: true }).limit(20);
  let callsQuery = context.service.from("call_logs").select("log_id,user_id,timestamp,outcome,notes,next_followup_date").eq("lead_id", leadId).order("timestamp", { ascending: false }).order("log_id", { ascending: false }).limit(10);
  if (!isAdmin) {
    tasksQuery = tasksQuery.eq("assigned_to", context.userId);
    callsQuery = callsQuery.eq("user_id", context.userId);
  }

  const [ownerResult, tasksResult, callsResult, transitionsResult] = await Promise.all([
    leadResult.data.assigned_to ? context.service.from("users").select("user_id,name").eq("user_id", leadResult.data.assigned_to).maybeSingle() : Promise.resolve({ data: null, error: null }),
    tasksQuery,
    callsQuery,
    context.service.from("pipeline_transition_operations").select("operation_id,actor_id,expected_stage,target_stage,confirmed_at,event_kind,reason").eq("lead_id", leadId).order("confirmed_at", { ascending: false }).limit(20),
  ]);
  if (ownerResult.error || tasksResult.error || callsResult.error || transitionsResult.error) return Response.json({ code: "PIPELINE_CONTEXT_FAILED" }, { status: 502 });

  const tasks = (tasksResult.data ?? []).filter((task) => canReadLinkedWork(isAdmin, context.userId, task.assigned_to));
  const calls = (callsResult.data ?? []).filter((call) => canReadLinkedWork(isAdmin, context.userId, call.user_id));
  const openTasks = tasks.filter((task) => task.status !== "Completed" && task.status !== "Missed");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return Response.json({
    lead: { ...leadResult.data, owner_name: ownerResult.data?.name ?? "Unassigned" },
    stage_age_days: Math.max(0, Math.floor((Date.now() - new Date(leadResult.data.stage_entered_at ?? leadResult.data.created_at).getTime()) / 86_400_000)),
    transitions: transitionsResult.data ?? [],
    next_task: openTasks[0] ?? null,
    overdue_tasks: openTasks.filter((task) => task.due_date < today),
    recent_tasks: tasks.slice(0, 10),
    latest_call: calls[0] ?? null,
    recent_calls: calls,
  }, { headers: { "Cache-Control": "no-store" } });
}
