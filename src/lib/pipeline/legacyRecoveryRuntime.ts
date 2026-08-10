import { countActiveSyncQueueItems, db, type LocalLead, type SyncQueueItem } from "../db";
import { confirmPipelineTransition } from "../leadStageService";
import { PIPELINE_TRANSITION_QUEUE_TABLE, type PipelineLeadView, type PipelineTransitionCommand } from "./contract";
import type { PipelineStage } from "../pipelineStages";
import { isLegacyPipelineStatusMutation } from "./legacyQueue";
import { executeRecoverySteps, planLegacyStageRecovery, type ConfirmedPipelineOperation, type LegacyStatusEvidence, type RecoveryEvidenceState } from "./legacyRecovery";

export interface LegacyRecoveryRunSummary {
  autoRecoverable: number;
  recovered: number;
  alreadySatisfied: number;
  reviewRequired: number;
  noEvidence: number;
  serverChanged: boolean;
}

function toEvidence(item: SyncQueueItem): LegacyStatusEvidence | null {
  if (!item.id || !isLegacyPipelineStatusMutation(item)) return null;
  const data = item.data as { lead_id?: string; status?: unknown };
  return { id: item.id, idempotencyKey: item.idempotency_key, ownerUserId: item.owner_user_id, leadId: data.lead_id, target: data.status, timestamp: item.timestamp, recoveryState: item.recovery_state };
}

async function markEvidence(ids: number[], state: RecoveryEvidenceState, reason: string) {
  const markedAt = new Date().toISOString();
  await db.transaction("rw", db.sync_queue, async () => {
    for (const id of ids) await db.sync_queue.update(id, { recovery_state: state, recovery_reason: reason, recovery_marked_at: markedAt });
  });
}

export async function recoverOwnedLegacyPipelineStages(args: {
  actorId: string;
  serverLeads: PipelineLeadView[];
  localLeads: LocalLead[];
  queue: SyncQueueItem[];
  confirmedOperations: ConfirmedPipelineOperation[];
  safeReplayTargets: PipelineStage[];
}): Promise<LegacyRecoveryRunSummary> {
  const summary: LegacyRecoveryRunSummary = { autoRecoverable: 0, recovered: 0, alreadySatisfied: 0, reviewRequired: 0, noEvidence: 0, serverChanged: false };
  const evidence = args.queue.map(toEvidence).filter(Boolean) as LegacyStatusEvidence[];
  const semanticCommands = args.queue.filter((item) => item.table_name === PIPELINE_TRANSITION_QUEUE_TABLE).map((item) => item.data as PipelineTransitionCommand);

  for (const serverLead of args.serverLeads.filter((lead) => lead.assigned_to === args.actorId)) {
    const plan = planLegacyStageRecovery({
      authenticatedUserId: args.actorId,
      serverLead,
      localLead: args.localLeads.find((lead) => lead.lead_id === serverLead.lead_id),
      legacyItems: evidence,
      semanticCommands,
      confirmedOperations: args.confirmedOperations,
      safeReplayTargets: args.safeReplayTargets,
    });
    if (plan.status === "NO_RECOVERY_NEEDED") { summary.noEvidence += 1; continue; }
    if (plan.status === "REVIEW_REQUIRED") {
      summary.reviewRequired += 1;
      await markEvidence(plan.reviewEvidenceIds, "review_required", plan.reason);
      continue;
    }
    if (plan.status === "ALREADY_SATISFIED") {
      summary.alreadySatisfied += 1;
      await markEvidence(plan.satisfiedEvidenceIds, "satisfied", plan.reason);
      continue;
    }

    summary.autoRecoverable += 1;
    if (plan.satisfiedEvidenceIds.length) await markEvidence(plan.satisfiedEvidenceIds, "satisfied", "PREFIX_ALREADY_CONFIRMED");
    const execution = await executeRecoverySteps(serverLead.lead_id, args.actorId, plan.steps, async (command) => {
      const result = await confirmPipelineTransition(command);
      if (result.status === "confirmed") {
        const step = plan.steps.find((candidate) => candidate.operationId === command.operation_id);
        if (step) await markEvidence(step.evidenceIds, "recovered", "CONFIRMED_BY_V2_WITH_HISTORICAL_OPERATION_ID");
        summary.serverChanged = true;
      }
      return result.status;
    });
    if (execution.status === "confirmed") summary.recovered += 1;
    else {
      const confirmedIds = new Set(execution.confirmedOperationIds);
      const remainingIds = plan.steps.filter((step) => !confirmedIds.has(step.operationId)).flatMap((step) => step.evidenceIds);
      await markEvidence(remainingIds, "review_required", execution.status === "conflict" ? "SERVER_CONFLICT_STOPPED_RECOVERY" : "RECOVERY_CONFIRMATION_NOT_PROVEN");
    }
  }

  if ((await countActiveSyncQueueItems()) === 0 && typeof localStorage !== "undefined") localStorage.removeItem("zerodata_outbox_owner_id");
  return summary;
}
