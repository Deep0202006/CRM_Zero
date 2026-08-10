import { executeRecoverySteps, planLegacyStageRecovery, sortLegacyStatusEvidence, type LegacyRecoveryInput, type LegacyStatusEvidence } from "../../pipeline/legacyRecovery";
import { PIPELINE_STAGES, type PipelineStage } from "../../pipelineStages";
import type { PipelineLeadView } from "../../pipeline/contract";

const owner = "11111111-1111-4111-8111-111111111111";
const leadId = "22222222-2222-4222-8222-222222222222";
const operationIds = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
];

const serverLead = (status: PipelineStage = "New"): PipelineLeadView => ({
  lead_id: leadId, business_name: "Fixture", contact_person: "Fixture", phone: "0000000000", segment_type: "Retailer",
  status, assigned_to: owner, owner_name: "Owner", created_at: "2026-01-01T00:00:00.000Z",
});
const evidence = (targets: PipelineStage[]): LegacyStatusEvidence[] => targets.map((target, index) => ({
  id: index + 1, idempotencyKey: operationIds[index], ownerUserId: owner, leadId, target, timestamp: `2026-08-01T00:00:0${index}.000Z`,
}));
const input = (targets: PipelineStage[], server: PipelineStage = "New", local: PipelineStage = targets.at(-1) ?? "New"): LegacyRecoveryInput => ({
  authenticatedUserId: owner, serverLead: serverLead(server), localLead: { lead_id: leadId, assigned_to: owner, status: local }, legacyItems: evidence(targets),
  semanticCommands: [], confirmedOperations: [], safeReplayTargets: PIPELINE_STAGES,
});

describe("pre-032 Pipeline legacy recovery planner", () => {
  test("sorts by timestamp and numeric ID, then collapses only consecutive duplicates", () => {
    const items = evidence(["Contacted", "Contacted", "Interested"]);
    items[0].timestamp = items[1].timestamp;
    expect(sortLegacyStatusEvidence([items[2], items[1], items[0]]).map((item) => item.id)).toEqual([1, 2, 3]);
    const plan = planLegacyStageRecovery(input(["Contacted", "Contacted", "Interested"], "New", "Interested"));
    expect(plan.steps).toHaveLength(2); expect(plan.steps[0].evidenceIds).toEqual([1, 2]);
  });

  test("reconstructs the complete New to Installation chain with high confidence", () => {
    const plan = planLegacyStageRecovery(input(["Contacted", "Interested", "Registration", "Installation"]));
    expect(plan.status).toBe("HIGH_CONFIDENCE_RECOVERY");
    expect(plan.steps.map((step) => `${step.expectedStage}->${step.targetStage}`)).toEqual(["New->Contacted", "Contacted->Interested", "Interested->Registration", "Registration->Installation"]);
  });

  test("a single New to Installation target is never guessed", () => {
    expect(planLegacyStageRecovery(input(["Installation"]))).toMatchObject({ status: "REVIEW_REQUIRED", reason: "LEGACY_CHAIN_DOES_NOT_CONTINUE_FROM_SERVER_STAGE" });
  });

  test("local final stage must agree", () => {
    expect(planLegacyStageRecovery(input(["Contacted", "Interested"], "New", "Contacted")).reason).toBe("LOCAL_FINAL_STAGE_DISAGREES_WITH_LEGACY_CHAIN");
  });

  test("owner mismatch and missing owner evidence cannot recover", () => {
    expect(planLegacyStageRecovery({ ...input(["Contacted"]), authenticatedUserId: "33333333-3333-4333-8333-333333333333" }).status).toBe("REVIEW_REQUIRED");
    const missing = input(["Contacted"]); missing.legacyItems[0].ownerUserId = undefined;
    expect(planLegacyStageRecovery(missing).reason).toBe("LEGACY_OWNER_EVIDENCE_MISSING_OR_MISMATCHED");
  });

  test("invalid target and invalid hop cannot recover", () => {
    const invalidTarget = input(["Contacted"]); invalidTarget.legacyItems[0].target = "Closed";
    expect(planLegacyStageRecovery(invalidTarget).reason).toBe("INVALID_LEGACY_STAGE");
    expect(planLegacyStageRecovery(input(["Contacted", "Registration"], "New", "Registration")).reason).toBe("INVALID_LEGACY_TRANSITION_HOP");
  });

  test("invalid timestamps cannot enter a guessed ordering", () => {
    const candidate = input(["Contacted"]); candidate.legacyItems[0].timestamp = "unknown";
    expect(planLegacyStageRecovery(candidate).reason).toBe("INVALID_LEGACY_TIMESTAMP");
  });

  test("partially satisfied prefix resumes from the current server stage", () => {
    const plan = planLegacyStageRecovery(input(["Contacted", "Interested", "Registration"], "Contacted", "Registration"));
    expect(plan.status).toBe("HIGH_CONFIDENCE_RECOVERY");
    expect(plan.satisfiedEvidenceIds).toEqual([1]);
    expect(plan.steps.map((step) => step.targetStage)).toEqual(["Interested", "Registration"]);
  });

  test("new semantic or post-032 work blocks stale recovery", () => {
    const semantic = input(["Contacted"]); semantic.semanticCommands = [{ operation_id: operationIds[3], lead_id: leadId, expected_stage: "New", target_stage: "Contacted", actor_id: owner, created_at: "2026-08-10T00:00:00Z" }];
    expect(planLegacyStageRecovery(semantic).reason).toBe("CURRENT_SEMANTIC_COMMAND_EXISTS");
    const newer = input(["Contacted"]); newer.confirmedOperations = [{ operationId: operationIds[3], leadId, actorId: owner, expectedStage: "New", targetStage: "Contacted", confirmedAt: "2026-08-10T00:00:00Z" }];
    expect(planLegacyStageRecovery(newer).reason).toBe("NEWER_POST32_OPERATION_EXISTS");
  });

  test("historical UUID identities become operation IDs and expected stages are never null", () => {
    const plan = planLegacyStageRecovery(input(["Contacted", "Interested"]));
    expect(plan.steps.map((step) => step.operationId)).toEqual(operationIds.slice(0, 2));
    expect(plan.steps.every((step) => step.expectedStage !== null)).toBe(true);
  });

  test("duplicate operation identity and ledger/server contradiction require review", () => {
    const duplicate = input(["Contacted", "Interested"]); duplicate.legacyItems[1].idempotencyKey = duplicate.legacyItems[0].idempotencyKey;
    expect(planLegacyStageRecovery(duplicate).reason).toBe("DUPLICATE_LEGACY_OPERATION_ID");
    const contradiction = input(["Contacted"], "New", "Contacted");
    contradiction.confirmedOperations = [{ operationId: operationIds[0], leadId, actorId: owner, expectedStage: "New", targetStage: "Contacted", confirmedAt: "2026-08-10T00:00:00Z" }];
    expect(planLegacyStageRecovery(contradiction).reason).toBe("OPERATION_LEDGER_DISAGREES_WITH_SERVER_STAGE");
  });

  test("unproven transition side effects force review", () => {
    expect(planLegacyStageRecovery({ ...input(["Contacted"]), safeReplayTargets: [] }).reason).toBe("TRANSITION_SIDE_EFFECT_SAFETY_NOT_PROVEN");
  });

  test("confirmed historical operation is idempotently already satisfied", () => {
    const candidate = input(["Contacted"], "Contacted", "Contacted");
    candidate.confirmedOperations = [{ operationId: operationIds[0], leadId, actorId: owner, expectedStage: "New", targetStage: "Contacted", confirmedAt: "2026-08-10T00:00:00Z" }];
    expect(planLegacyStageRecovery(candidate).status).toBe("ALREADY_SATISFIED");
  });

  test("executor stops at conflict and reuses identical commands on retry", async () => {
    const steps = planLegacyStageRecovery(input(["Contacted", "Interested"])).steps;
    const first = await executeRecoverySteps(leadId, owner, steps, async (command) => command.target_stage === "Interested" ? "conflict" : "confirmed");
    expect(first.status).toBe("conflict"); expect(first.commands).toHaveLength(2);
    const retry = await executeRecoverySteps(leadId, owner, steps, async () => "confirmed");
    expect(retry.commands).toEqual(steps.map((step) => ({ operation_id: step.operationId, lead_id: leadId, expected_stage: step.expectedStage, target_stage: step.targetStage, actor_id: owner, created_at: step.createdAt })));
  });
});
