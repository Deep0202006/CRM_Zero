import { createPipelineServerContext, readAuthorizedPipeline, readOwnedPipelineOperationEvidence } from "../server";
import type { ConfirmedPipelineOperation } from "@/lib/pipeline/legacyRecovery";

export async function GET(request: Request) {
  const context = await createPipelineServerContext(request);
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));
    const segment = url.searchParams.get("segment");
    if (segment !== "Retailer" && segment !== "Distributor") return Response.json({ code: "PIPELINE_INVALID_SEGMENT" }, { status: 400 });
    const result = await readAuthorizedPipeline(context, page, pageSize, segment);
    const leads = result.leads;
    let operations: ConfirmedPipelineOperation[] = [];
    let sideEffectPolicy = "REVIEW_REQUIRED_UNTIL_DEPLOYED_TRIGGER_IDEMPOTENCY_IS_PROVEN";
    try {
      operations = await readOwnedPipelineOperationEvidence(context, leads);
    } catch {
      sideEffectPolicy = "RECOVERY_EVIDENCE_UNAVAILABLE";
    }
    return Response.json({
      leads, page, pageSize, total: result.total, has_more: page * pageSize < result.total,
      segments: context.segments,
      recovery: {
        operations,
        safe_replay_targets: [],
        side_effect_policy: sideEffectPolicy,
      },
    });
  } catch {
    return Response.json({ code: "PIPELINE_READ_FAILED" }, { status: 502 });
  }
}
