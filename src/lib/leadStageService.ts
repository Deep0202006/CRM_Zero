import { db } from "./db";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { PIPELINE_TRANSITION_QUEUE_TABLE, assertOwnerTransition, type PipelineLeadView, type PipelineTransitionCommand } from "./pipeline/contract";
import type { PipelineStage } from "./pipelineStages";

export type PipelineTransitionResult =
  | { status: "confirmed"; command: PipelineTransitionCommand; lead: PipelineLeadView }
  | { status: "pending"; command: PipelineTransitionCommand }
  | { status: "conflict"; command: PipelineTransitionCommand; currentStage: PipelineStage; message: string }
  | { status: "rejected"; command: PipelineTransitionCommand; code: string; message: string };

function createCommand(leadId: string, expectedStage: PipelineStage, targetStage: PipelineStage, actorId: string): PipelineTransitionCommand {
  return { operation_id: crypto.randomUUID(), lead_id: leadId, expected_stage: expectedStage, target_stage: targetStage, actor_id: actorId, created_at: new Date().toISOString() };
}

async function persistCommand(command: PipelineTransitionCommand) {
  await db.sync_queue.add({ idempotency_key: `pipeline-transition:${command.operation_id}`, owner_user_id: command.actor_id, table_name: PIPELINE_TRANSITION_QUEUE_TABLE, action: "INSERT", data: command, timestamp: command.created_at });
}

async function markCommand(command: PipelineTransitionCommand, lastError: string) {
  const item = await db.sync_queue.where("idempotency_key").equals(`pipeline-transition:${command.operation_id}`).first();
  if (item?.id) await db.sync_queue.update(item.id, { last_error: lastError, retry_count: (item.retry_count ?? 0) + 1 });
}

export async function confirmPipelineTransition(command: PipelineTransitionCommand): Promise<PipelineTransitionResult> {
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) return { status: "pending", command };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { status: "pending", command };
  try {
    const response = await fetch("/api/pipeline/transition", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
    const result = await response.json() as { code?: string; message?: string; current_stage?: PipelineStage; lead?: PipelineLeadView; operation_id?: string };
    if (response.status === 409 && result.current_stage) {
      await markCommand(command, `PIPELINE_CONFLICT:${result.current_stage}`);
      if (result.lead) await db.leads.put(result.lead);
      return { status: "conflict", command, currentStage: result.current_stage, message: `This lead was updated elsewhere. Latest stage is ${result.current_stage}.` };
    }
    if (!response.ok || !result.lead || result.operation_id !== command.operation_id) {
      const code = result.code ?? "PIPELINE_UNAVAILABLE";
      await markCommand(command, code);
      if (response.status >= 500 || code === "PIPELINE_CONFIGURATION") return { status: "pending", command };
      return { status: "rejected", command, code, message: result.message ?? "The transition was not permitted." };
    }
    await db.leads.put(result.lead);
    const item = await db.sync_queue.where("idempotency_key").equals(`pipeline-transition:${command.operation_id}`).first();
    if (item?.id) await db.sync_queue.delete(item.id);
    return { status: "confirmed", command, lead: result.lead };
  } catch {
    await markCommand(command, "PIPELINE_UNAVAILABLE");
    return { status: "pending", command };
  }
}

export async function transitionLead(leadId: string, targetStage: PipelineStage, expectedStage: PipelineStage, actorId: string, assignedTo: string | null): Promise<PipelineTransitionResult> {
  const command = createCommand(leadId, expectedStage, targetStage, actorId);
  assertOwnerTransition(command, assignedTo);
  await persistCommand(command);
  return confirmPipelineTransition(command);
}

export async function retryPendingPipelineTransitions(actorId: string): Promise<PipelineTransitionResult[]> {
  const items = await db.sync_queue.where("table_name").equals(PIPELINE_TRANSITION_QUEUE_TABLE).toArray();
  const results: PipelineTransitionResult[] = [];
  for (const item of items) {
    const retryable = !item.last_error || item.last_error === "PIPELINE_UNAVAILABLE" || item.last_error === "PIPELINE_CONFIGURATION";
    if (item.owner_user_id !== actorId || !retryable) continue;
    results.push(await confirmPipelineTransition(item.data as PipelineTransitionCommand));
  }
  return results;
}
