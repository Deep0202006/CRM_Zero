import { z } from "zod";
import { getCurrentISTDate } from "@/lib/dateTime";
import { boundedReportJson, createReportResource } from "@/lib/analytics/reportResource";
import { attentionReasons, buildSalesHistory, completedStageVelocity, currentStageAgeRows, orderedStageCounts, parsePipelineFilters, pipelineRegisterSchema, sourceConversionRows } from "@/lib/pipeline/salesReview";
import { createPipelineServerContext } from "../server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const historySchema = z.object({
  leads: z.array(z.object({ lead_id: z.string(), created_at: z.string() })).max(2000),
  transitions: z.array(z.object({ operation_id: z.string(), lead_id: z.string(), actor_id: z.string().nullable(), expected_stage: z.string(), target_stage: z.string(), confirmed_at: z.string(), event_kind: z.string(), reason: z.string().nullable() })).max(2000),
  lead_limited: z.boolean(), transition_limited: z.boolean(),
});

export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  try {
    const context = await createPipelineServerContext(request, resource);
    if (context instanceof Response) return context;
    if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
    const capability = await resource.read(context.service.from("user_capabilities").select("capability_code").eq("user_id", context.userId).eq("capability_code", "admin").limit(1), true);
    if (capability.error) return Response.json({ code: "PIPELINE_AUTHORIZATION_FAILED" }, { status: 503 });
    if (capability.data?.[0]?.capability_code !== "admin") return Response.json({ code: "PIPELINE_ADMIN_REQUIRED" }, { status: 403 });
    const params = new URL(request.url).searchParams, segment = params.get("segment");
    let filters;
    try {
      filters = parsePipelineFilters(params);
      if (segment && segment !== "Retailer" && segment !== "Distributor") throw new Error("segment");
      if ([...params.keys()].some(key => !["segment", "stage", "owner", "source", "search", "stale", "overdue", "recentChange"].includes(key) || params.getAll(key).length !== 1)) throw new Error("filters");
      if (["stale", "overdue", "recentChange"].some(key => params.has(key) && !["true", "false"].includes(params.get(key)!))) throw new Error("boolean");
    } catch { return Response.json({ code: "PIPELINE_INVALID_FILTER" }, { status: 400 }); }
    const now = new Date().toISOString(), today = getCurrentISTDate();
    const stale = params.get("stale") === "true", overdue = params.get("overdue") === "true", recent = params.get("recentChange") === "true";
    const registerResult = await resource.read(context.service.rpc("crm_pipeline_register_v1", {
      p_segment: segment, p_search: filters.search, p_owner: filters.owner || null, p_source: filters.source || null, p_stage: filters.stage || null,
      p_page: 1, p_page_size: 50, p_inspection: true, p_stale: stale, p_overdue: overdue, p_recent: recent, p_as_of: now,
    }));
    if (registerResult.error) return Response.json({ code: "PIPELINE_INSPECTION_CAPABILITY_UNAVAILABLE" }, { status: 503 });
    const register = pipelineRegisterSchema.parse(registerResult.data);
    let funnel = context.service.from("pipeline_funnel_summary").select("segment_type,status,lead_count").limit(100);
    let sources = context.service.from("lead_source_performance").select("lead_source,segment_type,total_leads,converted,conversion_rate_pct", { count: "exact" }).order("segment_type").order("lead_source").limit(100);
    let ages = context.service.from("avg_time_in_stage").select("status,segment_type,avg_days_in_current_stage").limit(100);
    if (segment) { funnel = funnel.eq("segment_type", segment); sources = sources.eq("segment_type", segment); ages = ages.eq("segment_type", segment); }
    const [funnelResult, sourceResult, ageResult, historyResult, owners] = await Promise.all([
      resource.read(funnel), resource.read(sources), resource.read(ages),
      resource.read(context.service.rpc("crm_pipeline_history_v1", { p_segment: segment, p_from: new Date(Date.parse(now) - 367 * 86400000).toISOString(), p_to: now })),
      resource.read(context.service.from("users").select("user_id,name").eq("is_active", true).order("name").order("user_id").limit(50)),
    ]);
    const history = historyResult.error ? null : historySchema.safeParse(historyResult.data);
    const facts = history && history.success ? history.data : null;
    const sourcesComplete = !sourceResult.error && sourceResult.count !== null && sourceResult.count === sourceResult.data?.length;
    return boundedReportJson({
      scope: { page_size: 50, matched_total: register.total, generated_at: now, filters: { segment, ...filters, stale, overdue, recent_change: recent },
        facet_definition: "Same segment/search/owner/source; all stages and attention states", consistency: "Live multi-request reads" },
      stages: orderedStageCounts(register.stages.map(row => ({ status: row.stage, lead_count: row.count }))),
      sources: sourcesComplete ? sourceConversionRows(sourceResult.data ?? []) : [],
      current_stage_age: ageResult.error || funnelResult.error ? [] : currentStageAgeRows(ageResult.data ?? [], funnelResult.data ?? []),
      analytics_unavailable: [!sourcesComplete && "Source conversion", (ageResult.error || funnelResult.error) && "Current stage age", !facts && "Event history"].filter(Boolean),
      historical_velocity: facts ? completedStageVelocity(facts.transitions, facts.transition_limited) : { rows: [], sample_n: 0, coverage_n: 0, coverage_pct: 0 },
      owner_options: owners.error ? [] : owners.data ?? [],
      history: { weeks: facts ? buildSalesHistory(facts.leads, facts.transitions, today, "weeks") : [], months: facts ? buildSalesHistory(facts.leads, facts.transitions, today, "months") : [],
        lead_sample_n: facts?.leads.length ?? 0, transition_sample_n: facts?.transitions.length ?? 0,
        lead_sample_limited: facts?.lead_limited ?? true, transition_sample_limited: facts?.transition_limited ?? true,
        coverage: facts ? "Independent segment/date-filtered retained events over the last 367 days. Limited samples are lower bounds, not complete activity." : "Event history unavailable; register remains usable." },
      leads: register.leads.map(lead => {
        const stageAgeDays = Math.max(0, Math.floor((Date.parse(now) - Date.parse(lead.stage_entered_at ?? lead.created_at)) / 86400000));
        return { ...lead, stage_age_days: stageAgeDays, stale: stageAgeDays >= 14, attention_reasons: attentionReasons({ stageAgeDays, today, nextTaskDueDate: lead.next_task?.due_date, latestTransition: lead.recent_transition }) };
      }), diagnostics: resource.diagnostics,
    });
  } catch { return Response.json({ code: "PIPELINE_INSPECTION_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  finally { resource.finish(); }
}
