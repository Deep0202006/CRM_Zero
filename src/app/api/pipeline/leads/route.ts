import { createPipelineServerContext, readAuthorizedPipeline, readOwnedPipelineOperationEvidence } from "../server";
import type { ConfirmedPipelineOperation } from "@/lib/pipeline/legacyRecovery";
import { boundedReportJson, createReportResource } from "@/lib/analytics/reportResource";
import { parsePipelineFilters } from "@/lib/pipeline/salesReview";

export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  try {
  const context = await createPipelineServerContext(request, resource);
  if (context instanceof Response) return context;
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1"), pageSize = Number(url.searchParams.get("pageSize") ?? "50");
    let filters;
    try {
      filters = parsePipelineFilters(url.searchParams);
      if (!Number.isInteger(page) || page < 1 || page > 400 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50
        || [...url.searchParams.keys()].some(key => !["segment", "page", "pageSize", "search", "stage", "owner", "source"].includes(key))) throw new Error("filters");
    } catch { return Response.json({ code: "PIPELINE_INVALID_FILTER" }, { status: 400 }); }
    const segment = url.searchParams.get("segment");
    if (segment !== "Retailer" && segment !== "Distributor") return Response.json({ code: "PIPELINE_INVALID_SEGMENT" }, { status: 400 });
    const result = await readAuthorizedPipeline(context, page, pageSize, segment, filters, resource);
    const leads = result.leads;
    let operations: ConfirmedPipelineOperation[] = [];
    let sideEffectPolicy = "REVIEW_REQUIRED_UNTIL_DEPLOYED_TRIGGER_IDEMPOTENCY_IS_PROVEN";
    try {
      operations = await readOwnedPipelineOperationEvidence(context, leads, resource);
    } catch {
      sideEffectPolicy = "RECOVERY_EVIDENCE_UNAVAILABLE";
    }
    return boundedReportJson({
      leads, page, pageSize, total: result.total, has_more: page * pageSize < result.total,
      filters, stages: result.stages, facet_scope: "Same segment/search/owner/source, excluding selected stage", analytics_available: result.stages !== null,
      diagnostics: resource.diagnostics,
      segments: context.segments,
      recovery: {
        operations,
        safe_replay_targets: [],
        side_effect_policy: sideEffectPolicy,
      },
    });
  } catch {
    return Response.json({ code: "PIPELINE_READ_FAILED" }, { status: 502 });
  } finally { resource.finish(); }
}
