import { canEmployeeTransition, isPipelineStage, type PipelineLeadView, type PipelineTransitionCommand } from "./contract";
import type { PipelineStage } from "../pipelineStages";

export type LegacyRecoveryStatus = "HIGH_CONFIDENCE_RECOVERY" | "ALREADY_SATISFIED" | "NO_RECOVERY_NEEDED" | "REVIEW_REQUIRED";
export type RecoveryEvidenceState = "recovered" | "satisfied" | "review_required" | "quarantined";

export interface LegacyStatusEvidence {
  id: number;
  idempotencyKey: string;
  ownerUserId?: string;
  leadId?: string;
  target: unknown;
  timestamp: string;
  recoveryState?: RecoveryEvidenceState;
}

export interface ConfirmedPipelineOperation {
  operationId: string;
  leadId: string;
  actorId: string;
  expectedStage: PipelineStage;
  targetStage: PipelineStage;
  confirmedAt: string;
}

export interface RecoveryStep {
  operationId: string;
  expectedStage: PipelineStage;
  targetStage: PipelineStage;
  evidenceIds: number[];
  createdAt: string;
}

export interface LegacyRecoveryPlan {
  status: LegacyRecoveryStatus;
  reason: string;
  steps: RecoveryStep[];
  satisfiedEvidenceIds: number[];
  reviewEvidenceIds: number[];
}

export interface LegacyRecoveryInput {
  authenticatedUserId: string;
  serverLead: PipelineLeadView;
  localLead?: { lead_id: string; assigned_to?: string | null; status: unknown };
  legacyItems: LegacyStatusEvidence[];
  semanticCommands: PipelineTransitionCommand[];
  confirmedOperations: ConfirmedPipelineOperation[];
  safeReplayTargets: readonly PipelineStage[];
}

export async function executeRecoverySteps(
  leadId: string,
  actorId: string,
  steps: RecoveryStep[],
  confirm: (command: PipelineTransitionCommand) => Promise<"confirmed" | "conflict" | "pending" | "rejected">,
) {
  const commands: PipelineTransitionCommand[] = [];
  const confirmedOperationIds: string[] = [];
  for (const step of steps) {
    const command: PipelineTransitionCommand = { operation_id: step.operationId, lead_id: leadId, expected_stage: step.expectedStage, target_stage: step.targetStage, actor_id: actorId, created_at: step.createdAt };
    commands.push(command);
    const status = await confirm(command);
    if (status !== "confirmed") return { status, commands, confirmedOperationIds };
    confirmedOperationIds.push(command.operation_id);
  }
  return { status: "confirmed" as const, commands, confirmedOperationIds };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function review(reason: string, evidenceIds: number[]): LegacyRecoveryPlan {
  return { status: "REVIEW_REQUIRED", reason, steps: [], satisfiedEvidenceIds: [], reviewEvidenceIds: evidenceIds };
}

export function sortLegacyStatusEvidence(items: LegacyStatusEvidence[]) {
  return [...items].sort((a, b) => {
    const time = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    return time || a.id - b.id;
  });
}

export function planLegacyStageRecovery(input: LegacyRecoveryInput): LegacyRecoveryPlan {
  const relevant = sortLegacyStatusEvidence(input.legacyItems.filter((item) => item.leadId === input.serverLead.lead_id));
  const ids = relevant.map((item) => item.id);
  if (relevant.length === 0) return { status: "NO_RECOVERY_NEEDED", reason: "NO_LOCAL_EVIDENCE", steps: [], satisfiedEvidenceIds: [], reviewEvidenceIds: [] };
  if (input.authenticatedUserId !== input.serverLead.assigned_to) return review("AUTHENTICATED_USER_IS_NOT_ASSIGNED_OWNER", ids);
  if (!input.localLead || input.localLead.lead_id !== input.serverLead.lead_id) return review("LOCAL_LEAD_EVIDENCE_MISSING", ids);
  if (input.localLead.assigned_to !== input.authenticatedUserId) return review("LOCAL_OWNER_MISMATCH", ids);
  if (relevant.some((item) => !item.ownerUserId || item.ownerUserId !== input.authenticatedUserId)) return review("LEGACY_OWNER_EVIDENCE_MISSING_OR_MISMATCHED", ids);
  if (relevant.some((item) => !Number.isFinite(Date.parse(item.timestamp)))) return review("INVALID_LEGACY_TIMESTAMP", ids);
  if (relevant.some((item) => !isPipelineStage(item.target))) return review("INVALID_LEGACY_STAGE", ids);
  if (relevant.some((item) => !UUID.test(item.idempotencyKey))) return review("LEGACY_OPERATION_ID_IS_NOT_UUID", ids);
  if (!isPipelineStage(input.localLead.status)) return review("INVALID_LOCAL_FINAL_STAGE", ids);

  const collapsed: Array<{ target: PipelineStage; operationId: string; evidenceIds: number[] }> = [];
  for (const item of relevant) {
    const target = item.target as PipelineStage;
    const previous = collapsed.at(-1);
    if (previous?.target === target) previous.evidenceIds.push(item.id);
    else collapsed.push({ target, operationId: item.idempotencyKey, evidenceIds: [item.id] });
  }
  if (collapsed.at(-1)?.target !== input.localLead.status) return review("LOCAL_FINAL_STAGE_DISAGREES_WITH_LEGACY_CHAIN", ids);

  for (let index = 1; index < collapsed.length; index += 1) {
    if (!canEmployeeTransition(collapsed[index - 1].target, collapsed[index].target)) return review("INVALID_LEGACY_TRANSITION_HOP", ids);
  }

  const legacyOperationIds = new Set(collapsed.map((item) => item.operationId));
  if (legacyOperationIds.size !== collapsed.length) return review("DUPLICATE_LEGACY_OPERATION_ID", ids);
  if (input.semanticCommands.some((command) => command.lead_id === input.serverLead.lead_id)) return review("CURRENT_SEMANTIC_COMMAND_EXISTS", ids);
  const newerUnrelated = input.confirmedOperations.some((operation) => operation.leadId === input.serverLead.lead_id && !legacyOperationIds.has(operation.operationId));
  if (newerUnrelated) return review("NEWER_POST32_OPERATION_EXISTS", ids);

  let startIndex = collapsed.findIndex((item) => item.target === input.serverLead.status);
  const satisfiedEvidenceIds: number[] = [];
  if (startIndex >= 0) {
    for (let index = 0; index <= startIndex; index += 1) satisfiedEvidenceIds.push(...collapsed[index].evidenceIds);
    startIndex += 1;
  } else {
    startIndex = 0;
  }

  let expected = input.serverLead.status;
  const steps: RecoveryStep[] = [];
  for (let index = startIndex; index < collapsed.length; index += 1) {
    const item = collapsed[index];
    if (!canEmployeeTransition(expected, item.target)) return review("LEGACY_CHAIN_DOES_NOT_CONTINUE_FROM_SERVER_STAGE", ids);
    const confirmed = input.confirmedOperations.find((operation) => operation.operationId === item.operationId);
    if (confirmed) {
      if (confirmed.leadId !== input.serverLead.lead_id || confirmed.actorId !== input.authenticatedUserId || confirmed.expectedStage !== expected || confirmed.targetStage !== item.target) return review("CONFIRMED_OPERATION_MISMATCH", ids);
      satisfiedEvidenceIds.push(...item.evidenceIds);
    } else {
      const source = relevant.find((evidence) => evidence.id === item.evidenceIds[0]);
      steps.push({ operationId: item.operationId, expectedStage: expected, targetStage: item.target, evidenceIds: item.evidenceIds, createdAt: source?.timestamp ?? new Date(0).toISOString() });
    }
    expected = item.target;
  }

  if (steps.length === 0) {
    if (input.serverLead.status !== input.localLead.status) return review("OPERATION_LEDGER_DISAGREES_WITH_SERVER_STAGE", ids);
    return { status: "ALREADY_SATISFIED", reason: "SERVER_OR_OPERATION_LEDGER_ALREADY_SATISFIES_CHAIN", steps: [], satisfiedEvidenceIds: ids, reviewEvidenceIds: [] };
  }
  const safeTargets = new Set(input.safeReplayTargets);
  if (steps.some((step) => !safeTargets.has(step.targetStage))) return review("TRANSITION_SIDE_EFFECT_SAFETY_NOT_PROVEN", ids);
  return { status: "HIGH_CONFIDENCE_RECOVERY", reason: "COMPLETE_OWNER_MATCHED_CANONICAL_CHAIN", steps, satisfiedEvidenceIds, reviewEvidenceIds: [] };
}
