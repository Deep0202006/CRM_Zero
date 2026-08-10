import { assertOwnerTransition, canEmployeeTransition, canSystemTransition, PIPELINE_TRANSITION_QUEUE_TABLE, type PipelineTransitionCommand } from "../../pipeline/contract";
import { isActiveSyncQueueItem, isLegacyPipelineStatusMutation, LEGACY_PIPELINE_STATUS_ERROR, preserveLegacyNonStatusUpdate } from "../../pipeline/legacyQueue";
import { pendingStateFromQueue } from "../../pipeline/repository";

const command: PipelineTransitionCommand = { operation_id: "operation", lead_id: "lead", expected_stage: "Contacted", target_stage: "Interested", actor_id: "owner", created_at: "2026-08-10T00:00:00Z" };

describe("Pipeline semantic transitions", () => {
  test("only assigned user may perform an employee transition, including Admin", () => {
    expect(() => assertOwnerTransition(command, "owner")).not.toThrow();
    expect(() => assertOwnerTransition({ ...command, actor_id: "same-segment-user" }, "owner")).toThrow("PIPELINE_NOT_ASSIGNED");
    expect(() => assertOwnerTransition({ ...command, actor_id: "admin-not-owner" }, "owner")).toThrow("PIPELINE_NOT_ASSIGNED");
  });

  test("Payment to Renewal Due is system-only", () => {
    expect(canEmployeeTransition("Payment", "Renewal Due")).toBe(false);
    expect(canSystemTransition("Payment", "Renewal Due")).toBe(true);
  });

  test("semantic queue retains operation, expected and target identity", () => {
    const item = { idempotency_key: `pipeline-transition:${command.operation_id}`, owner_user_id: "owner", table_name: PIPELINE_TRANSITION_QUEUE_TABLE, action: "INSERT" as const, data: command, timestamp: command.created_at };
    expect(item.data).toMatchObject({ operation_id: "operation", lead_id: "lead", expected_stage: "Contacted", target_stage: "Interested" });
    expect(JSON.stringify(item.data)).not.toContain("expected_stage\":null");
  });

  test("legacy generic status writes are preserved and visibly classified", () => {
    const legacy = { idempotency_key: "old", table_name: "leads", action: "UPDATE" as const, data: { lead_id: "lead", status: "Interested" }, timestamp: "old", last_error: LEGACY_PIPELINE_STATUS_ERROR };
    expect(isLegacyPipelineStatusMutation(legacy)).toBe(true);
    expect(pendingStateFromQueue([legacy]).get("lead")).toEqual({ target: "Interested", kind: "legacy" });
  });

  test("non-status fields in a legacy item remain eligible for ordinary sync exactly once", () => {
    const legacy = { idempotency_key: "old", table_name: "leads", action: "UPDATE" as const, data: { lead_id: "lead", status: "Interested", area: "Area" }, timestamp: "old" };
    const first = preserveLegacyNonStatusUpdate(legacy);
    expect(first.originalData).toMatchObject({ status: "Interested", __pipeline_non_status_requeued: true });
    expect(first.replayData).toEqual({ lead_id: "lead", area: "Area" });
    expect(preserveLegacyNonStatusUpdate({ ...legacy, data: first.originalData }).replayData).toBeNull();
  });

  test("a stale conflict is retained as review state rather than confirmed", () => {
    const item = { idempotency_key: "pipeline-transition:operation", table_name: PIPELINE_TRANSITION_QUEUE_TABLE, action: "INSERT" as const, data: command, timestamp: command.created_at, last_error: "PIPELINE_CONFLICT:Interested" };
    expect(pendingStateFromQueue([item]).get("lead")).toEqual({ target: "Interested", kind: "conflict" });
  });

  test("passive recovery evidence is excluded from warnings and active queue accounting", () => {
    const passive = { idempotency_key: "old", table_name: "leads", action: "UPDATE" as const, data: { lead_id: "lead", status: "Interested" }, timestamp: "old", recovery_state: "review_required" as const };
    expect(isLegacyPipelineStatusMutation(passive)).toBe(true);
    expect(isActiveSyncQueueItem(passive)).toBe(false);
    expect(pendingStateFromQueue([passive]).has("lead")).toBe(false);
  });
});
