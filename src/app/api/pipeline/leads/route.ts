import { createPipelineServerContext, readAuthorizedPipeline, readOwnedPipelineOperationEvidence } from "../server";
import type { ConfirmedPipelineOperation } from "@/lib/pipeline/legacyRecovery";

export async function GET(request: Request) {
  const context = await createPipelineServerContext(request);
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  try {
    const leads = await readAuthorizedPipeline(context);
    let operations: ConfirmedPipelineOperation[] = [];
    let sideEffectPolicy = "REVIEW_REQUIRED_UNTIL_DEPLOYED_TRIGGER_IDEMPOTENCY_IS_PROVEN";
    try {
      operations = await readOwnedPipelineOperationEvidence(context, leads);
    } catch {
      sideEffectPolicy = "RECOVERY_EVIDENCE_UNAVAILABLE";
    }
    return Response.json({
      leads,
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
