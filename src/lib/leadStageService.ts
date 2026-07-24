import { db, transactionalMutation } from "./db";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import { PIPELINE_STAGES, PipelineStage, isValidStageTransition, getNextPipelineStage } from "./pipelineStages";

/**
 * Executes a pipeline stage transition.
 * 
 * Flow:
 * 1. Validate the transition based on the current local stage.
 * 2. If online and Supabase is configured, try calling the `transition_lead_stage` RPC.
 *    - If the RPC fails due to concurrency, throw an error to the UI to refresh.
 *    - If it succeeds, update local Dexie state immediately.
 * 3. If offline, optimistically update Dexie and enqueue a regular update. 
 *    (When the sync engine pushes the update, the last-writer wins or we add special sync queue logic).
 */
export async function transitionLead(leadId: string, newStage: PipelineStage, expectedCurrentStage: PipelineStage) {
  if (!isValidStageTransition(expectedCurrentStage, newStage)) {
    throw new Error(`Invalid stage transition from ${expectedCurrentStage} to ${newStage}`);
  }

  const now = new Date().toISOString();

  if (navigator.onLine && isSupabaseConfigured) {
    // Attempt real-time atomic transition via RPC
    const { data, error } = await supabase.rpc("transition_lead_stage", {
      p_lead_id: leadId,
      p_expected_current_stage: expectedCurrentStage,
      p_new_stage: newStage,
      p_actor: "agent"
    });

    if (error) {
      throw new Error(`Transition failed: ${error.message}`);
    }

    if (data && !data.success) {
      throw new Error(`Concurrency error: ${data.error}`);
    }

    // RPC succeeded, update local Dexie immediately (bypass queue since server is already updated)
    await db.leads.update(leadId, { status: newStage, stage_entered_at: now });
  } else {
    // Offline mode: optimistically update Dexie and enqueue for sync.
    // The syncEngine will process this as a standard UPDATE when back online.
    await transactionalMutation("leads", "UPDATE", {
      lead_id: leadId,
      status: newStage,
    });
  }
}
