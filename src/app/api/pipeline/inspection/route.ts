import { PIPELINE_STAGES } from "@/lib/pipelineStages";
import { addISTDateDays, getISTDateKey } from "@/lib/dateTime";
import { createPipelineServerContext } from "../server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function movementSeries(rows: Array<{ confirmed_at?: string }>, window: "weeks" | "months") {
  const cutoff = Date.now() - (window === "weeks" ? 84 : 366) * 86_400_000;
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    if (!row.confirmed_at || Date.parse(row.confirmed_at) < cutoff) return;
    const date = getISTDateKey(row.confirmed_at);
    const key = window === "months" ? date.slice(0, 7) : addISTDateDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts].map(([period, movements]) => ({ period, movements })).sort((left, right) => left.period.localeCompare(right.period));
}

export async function GET(request: Request) {
  const context = await createPipelineServerContext(request);
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  const capabilityResult = await context.service.from("user_capabilities").select("capability_code").eq("user_id", context.userId);
  if (capabilityResult.error) return Response.json({ code: "PIPELINE_AUTHORIZATION_FAILED" }, { status: 503 });
  if (!(capabilityResult.data ?? []).some((item) => item.capability_code === "admin")) return Response.json({ code: "PIPELINE_ADMIN_REQUIRED" }, { status: 403 });

  const url = new URL(request.url);
  const segment = url.searchParams.get("segment");
  const stage = url.searchParams.get("stage");
  const owner = url.searchParams.get("owner");
  const source = url.searchParams.get("source");
  const stale = url.searchParams.get("stale") === "true";
  if (segment && segment !== "Retailer" && segment !== "Distributor") return Response.json({ code: "PIPELINE_INVALID_SEGMENT" }, { status: 400 });
  if (stage && !PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) return Response.json({ code: "PIPELINE_INVALID_STAGE" }, { status: 400 });

  let leadQuery = context.service.from("leads").select("lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,lead_source,area", { count: "exact" }).order("stage_entered_at", { ascending: false }).order("lead_id", { ascending: false }).limit(50);
  if (segment) leadQuery = leadQuery.eq("segment_type", segment);
  if (stage) leadQuery = leadQuery.eq("status", stage);
  if (owner) leadQuery = leadQuery.eq("assigned_to", owner);
  if (source) leadQuery = leadQuery.eq("lead_source", source);
  if (stale) leadQuery = leadQuery.lt("stage_entered_at", new Date(Date.now() - 14 * 86_400_000).toISOString());

  const [leadsResult, funnelResult, sourceResult, timeResult] = await Promise.all([
    leadQuery,
    context.service.from("pipeline_funnel_summary").select("segment_type,status,lead_count").limit(100),
    context.service.from("lead_source_performance").select("lead_source,segment_type,total_leads,converted,conversion_rate_pct").limit(100),
    context.service.from("avg_time_in_stage").select("status,segment_type,avg_days_in_current_stage").limit(100),
  ]);
  if (leadsResult.error || funnelResult.error || sourceResult.error || timeResult.error) return Response.json({ code: "PIPELINE_INSPECTION_FAILED" }, { status: 502 });

  const leads = leadsResult.data ?? [];
  const leadIds = leads.map((lead) => lead.lead_id);
  const ownerIds = [...new Set(leads.map((lead) => lead.assigned_to).filter((id): id is string => Boolean(id)))];
  const [ownersResult, tasksResult, callsResult, transitionsResult] = await Promise.all([
    ownerIds.length ? context.service.from("users").select("user_id,name").in("user_id", ownerIds) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? context.service.from("tasks").select("task_id,related_lead_id,title,status,due_date,priority").in("related_lead_id", leadIds).eq("is_active", true).neq("status", "Completed").order("due_date", { ascending: true }).limit(100) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? context.service.from("call_logs").select("log_id,lead_id,timestamp,outcome").in("lead_id", leadIds).order("timestamp", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? context.service.from("pipeline_transition_operations").select("operation_id,lead_id,expected_stage,target_stage,confirmed_at").in("lead_id", leadIds).order("confirmed_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ownersResult.error || tasksResult.error || callsResult.error || transitionsResult.error) return Response.json({ code: "PIPELINE_INSPECTION_CONTEXT_FAILED" }, { status: 502 });
  const ownerNames = new Map((ownersResult.data ?? []).map((item) => [item.user_id, item.name]));
  const firstByLead = <T extends Record<string, unknown>>(items: T[], key: keyof T) => new Map(items.map((item) => [String(item[key]), item]));
  const nextTasks = firstByLead(tasksResult.data ?? [], "related_lead_id");
  const recentCalls = firstByLead(callsResult.data ?? [], "lead_id");
  const recentTransitions = firstByLead(transitionsResult.data ?? [], "lead_id");
  const transitionRows = transitionsResult.data ?? [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return Response.json({
    scope: { page_size: 50, matched_total: leadsResult.count ?? 0, generated_at: new Date().toISOString() },
    stages: funnelResult.data ?? [],
    sources: sourceResult.data ?? [],
    velocity: timeResult.data ?? [],
    growth: { weeks: movementSeries(transitionRows, "weeks"), months: movementSeries(transitionRows, "months"), sample_n: transitionRows.length, coverage: "Latest 100 confirmed transitions for this bounded inspection page" },
    leads: leads.map((lead) => {
      const nextTask = nextTasks.get(lead.lead_id) as { due_date?: string } | undefined;
      const stageAgeDays = Math.max(0, Math.floor((Date.now() - new Date(lead.stage_entered_at ?? lead.created_at).getTime()) / 86_400_000));
      return { ...lead, owner_name: ownerNames.get(lead.assigned_to ?? "") ?? "Unassigned", stage_age_days: stageAgeDays, stale: stageAgeDays >= 14, attention: stageAgeDays >= 14 || Boolean(nextTask?.due_date && nextTask.due_date < today), next_task: nextTask ?? null, recent_call: recentCalls.get(lead.lead_id) ?? null, recent_transition: recentTransitions.get(lead.lead_id) ?? null };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
