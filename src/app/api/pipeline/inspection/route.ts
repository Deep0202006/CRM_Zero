import { getCurrentISTDate } from "@/lib/dateTime";
import { isCallLeadId } from "@/lib/callLogs/contract";
import { PIPELINE_STAGES } from "@/lib/pipelineStages";
import { attentionReasons, buildSalesHistory, completedStageVelocity, currentStageAgeRows, orderedStageCounts, sanitizePipelineSearch, sourceConversionRows, type PipelineTransitionFact } from "@/lib/pipeline/salesReview";
import { createPipelineServerContext } from "../server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_LIMIT = 50;
const FILTER_ID_LIMIT = 500;
const HISTORY_LIMIT = 2_000;
const IMPOSSIBLE_ID = "00000000-0000-0000-0000-000000000000";

function firstByLead<T extends Record<string, unknown>>(items: T[], key: keyof T) {
  const result = new Map<string, T>();
  for (const item of items) { const id = String(item[key]); if (!result.has(id)) result.set(id, item); }
  return result;
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
  const owner = url.searchParams.get("owner")?.trim() ?? "";
  const source = url.searchParams.get("source")?.trim().slice(0, 120) ?? "";
  const search = sanitizePipelineSearch(url.searchParams.get("search"));
  const stale = url.searchParams.get("stale") === "true";
  const overdue = url.searchParams.get("overdue") === "true";
  const recentChange = url.searchParams.get("recentChange") === "true";
  if (segment && segment !== "Retailer" && segment !== "Distributor") return Response.json({ code: "PIPELINE_INVALID_SEGMENT" }, { status: 400 });
  if (stage && !PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) return Response.json({ code: "PIPELINE_INVALID_STAGE" }, { status: 400 });
  if (owner && !isCallLeadId(owner)) return Response.json({ code: "PIPELINE_INVALID_OWNER" }, { status: 400 });

  const today = getCurrentISTDate();
  const staleCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const recentCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const historyCutoff = new Date(Date.now() - 367 * 86_400_000).toISOString();
  const [overdueFilterResult, recentFilterResult] = await Promise.all([
    overdue ? context.service.from("tasks").select("related_lead_id").eq("is_active", true).neq("status", "Completed").lt("due_date", today).not("related_lead_id", "is", null).limit(FILTER_ID_LIMIT) : Promise.resolve({ data: [], error: null }),
    recentChange ? context.service.from("pipeline_transition_operations").select("lead_id").gte("confirmed_at", recentCutoff).order("confirmed_at", { ascending: false }).limit(FILTER_ID_LIMIT) : Promise.resolve({ data: [], error: null }),
  ]);
  if (overdueFilterResult.error || recentFilterResult.error) return Response.json({ code: "PIPELINE_FILTER_FAILED" }, { status: 502 });
  const overdueLeadIds = [...new Set((overdueFilterResult.data ?? []).map((row) => row.related_lead_id).filter(Boolean))];
  const recentLeadIds = [...new Set((recentFilterResult.data ?? []).map((row) => row.lead_id).filter(Boolean))];

  let leadQuery = context.service.from("leads").select("lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,lead_source,area", { count: "exact" }).order("stage_entered_at", { ascending: false }).order("lead_id", { ascending: false }).limit(LIST_LIMIT);
  if (segment) leadQuery = leadQuery.eq("segment_type", segment);
  if (stage) leadQuery = leadQuery.eq("status", stage);
  if (owner) leadQuery = leadQuery.eq("assigned_to", owner);
  if (source) leadQuery = leadQuery.eq("lead_source", source);
  if (search) leadQuery = leadQuery.or(`business_name.ilike.%${search}%,contact_person.ilike.%${search}%,phone.ilike.%${search}%,area.ilike.%${search}%`);
  if (stale) leadQuery = leadQuery.lt("stage_entered_at", staleCutoff);
  if (overdue) leadQuery = leadQuery.in("lead_id", overdueLeadIds.length ? overdueLeadIds : [IMPOSSIBLE_ID]);
  if (recentChange) leadQuery = leadQuery.in("lead_id", recentLeadIds.length ? recentLeadIds : [IMPOSSIBLE_ID]);

  let funnelQuery = context.service.from("pipeline_funnel_summary").select("segment_type,status,lead_count").limit(100);
  let sourceQuery = context.service.from("lead_source_performance").select("lead_source,segment_type,total_leads,converted,conversion_rate_pct").limit(100);
  let currentAgeQuery = context.service.from("avg_time_in_stage").select("status,segment_type,avg_days_in_current_stage").limit(100);
  let historyLeadQuery = context.service.from("leads").select("lead_id,created_at,segment_type").order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (segment) { funnelQuery = funnelQuery.eq("segment_type", segment); sourceQuery = sourceQuery.eq("segment_type", segment); currentAgeQuery = currentAgeQuery.eq("segment_type", segment); historyLeadQuery = historyLeadQuery.eq("segment_type", segment); }
  const [leadsResult, funnelResult, sourceResult, currentAgeResult, historyLeadsResult, historyTransitionsResult, ownerOptionsResult] = await Promise.all([
    leadQuery, funnelQuery, sourceQuery, currentAgeQuery, historyLeadQuery,
    context.service.from("pipeline_transition_operations").select("lead_id,expected_stage,target_stage,confirmed_at").gte("confirmed_at", historyCutoff).order("confirmed_at", { ascending: false }).limit(HISTORY_LIMIT),
    context.service.from("users").select("user_id,name").eq("is_active", true).order("name", { ascending: true }).limit(50),
  ]);
  if (leadsResult.error || funnelResult.error || sourceResult.error || currentAgeResult.error || historyLeadsResult.error || historyTransitionsResult.error || ownerOptionsResult.error) return Response.json({ code: "PIPELINE_INSPECTION_FAILED" }, { status: 502 });

  const leads = leadsResult.data ?? [];
  const leadIds = leads.map((lead) => lead.lead_id);
  const ownerIds = [...new Set(leads.map((lead) => lead.assigned_to).filter((id): id is string => Boolean(id)))];
  const [ownersResult, tasksResult, callsResult, transitionsResult] = await Promise.all([
    ownerIds.length ? context.service.from("users").select("user_id,name").in("user_id", ownerIds) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? context.service.from("tasks").select("task_id,related_lead_id,title,status,due_date,priority").in("related_lead_id", leadIds).eq("is_active", true).neq("status", "Completed").order("due_date", { ascending: true }).order("task_id", { ascending: true }).limit(100) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? context.service.from("call_logs").select("log_id,lead_id,timestamp,outcome").in("lead_id", leadIds).order("timestamp", { ascending: false }).order("log_id", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    leadIds.length ? context.service.from("pipeline_transition_operations").select("operation_id,lead_id,expected_stage,target_stage,confirmed_at").in("lead_id", leadIds).order("confirmed_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ]);
  if (ownersResult.error || tasksResult.error || callsResult.error || transitionsResult.error) return Response.json({ code: "PIPELINE_INSPECTION_CONTEXT_FAILED" }, { status: 502 });

  const historyLeads = historyLeadsResult.data ?? [];
  const historyLeadMap = new Map(historyLeads.map((lead) => [lead.lead_id, lead]));
  const historyTransitions = (historyTransitionsResult.data ?? []).filter((row) => historyLeadMap.has(row.lead_id)) as PipelineTransitionFact[];
  const velocity = completedStageVelocity(historyTransitions, new Map(historyLeads.map((lead) => [lead.lead_id, lead.created_at])));
  const ownerNames = new Map((ownersResult.data ?? []).map((item) => [item.user_id, item.name]));
  const nextTasks = firstByLead(tasksResult.data ?? [], "related_lead_id");
  const recentCalls = firstByLead(callsResult.data ?? [], "lead_id");
  const recentTransitions = firstByLead(transitionsResult.data ?? [], "lead_id");
  const currentAge = currentStageAgeRows(currentAgeResult.data ?? [], funnelResult.data ?? []);

  return Response.json({
    scope: { page_size: LIST_LIMIT, matched_total: leadsResult.count ?? 0, generated_at: new Date().toISOString(), filters: { segment, stage, owner: owner || null, source: source || null, search: search || null, stale, overdue, recent_change: recentChange }, filter_coverage: { overdue_ids: overdueLeadIds.length, recent_change_ids: recentLeadIds.length, id_limit: FILTER_ID_LIMIT } },
    stages: orderedStageCounts(funnelResult.data ?? []),
    sources: sourceConversionRows(sourceResult.data ?? []),
    current_stage_age: currentAge,
    historical_velocity: velocity,
    owner_options: ownerOptionsResult.data ?? [],
    history: { weeks: buildSalesHistory(historyLeads, historyTransitions, today, "weeks"), months: buildSalesHistory(historyLeads, historyTransitions, today, "months"), lead_sample_n: historyLeads.length, transition_sample_n: historyTransitions.length, lead_sample_limited: historyLeads.length === HISTORY_LIMIT, transition_sample_limited: (historyTransitionsResult.data ?? []).length === HISTORY_LIMIT, coverage: `Latest ${HISTORY_LIMIT} leads and one year of up to ${HISTORY_LIMIT} confirmed transitions; zero periods are explicit.` },
    leads: leads.map((lead) => {
      const nextTask = nextTasks.get(lead.lead_id) as { due_date?: string } | undefined;
      const transition = recentTransitions.get(lead.lead_id) as PipelineTransitionFact | undefined;
      const stageAgeDays = Math.max(0, Math.floor((Date.now() - new Date(lead.stage_entered_at ?? lead.created_at).getTime()) / 86_400_000));
      return { ...lead, owner_name: ownerNames.get(lead.assigned_to ?? "") ?? "Unassigned", stage_age_days: stageAgeDays, stale: stageAgeDays >= 14, attention_reasons: attentionReasons({ stageAgeDays, today, nextTaskDueDate: nextTask?.due_date, latestTransition: transition }), next_task: nextTask ?? null, recent_call: recentCalls.get(lead.lead_id) ?? null, recent_transition: transition ?? null };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
