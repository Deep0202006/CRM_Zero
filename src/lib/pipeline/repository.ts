import { db, type LocalLead, type SyncQueueItem } from "../db";
import { supabase } from "../supabaseClient";
import { mergeAuthoritativePipeline, type PendingLeadCreation } from "./authority";
import { PIPELINE_TRANSITION_QUEUE_TABLE, type PipelineLeadView, type PipelineSegment, type PipelineTransitionCommand } from "./contract";
import { isLegacyPipelineStatusMutation } from "./legacyQueue";
import { recoverOwnedLegacyPipelineStages } from "./legacyRecoveryRuntime";
import type { ConfirmedPipelineOperation } from "./legacyRecovery";
import type { PipelineStage } from "../pipelineStages";

export interface PipelinePendingState {
  target: string;
  kind: "pending" | "conflict" | "legacy";
}

export interface PipelineSnapshot {
  leads: PipelineLeadView[];
  pending: Map<string, PipelinePendingState>;
  degraded: boolean;
}

function asLeadView(lead: LocalLead, ownerName: string): PipelineLeadView {
  return { ...lead, owner_name: lead.owner_name ?? ownerName } as PipelineLeadView;
}

export function pendingStateFromQueue(items: SyncQueueItem[]) {
  const states = new Map<string, PipelinePendingState>();
  for (const item of items) {
    if (isLegacyPipelineStatusMutation(item)) {
      if (item.recovery_state) continue;
      const data = item.data as { lead_id?: string; status?: string };
      if (data.lead_id) states.set(data.lead_id, { target: data.status ?? "unknown", kind: "legacy" });
      continue;
    }
    if (item.table_name === PIPELINE_TRANSITION_QUEUE_TABLE) {
      const command = item.data as PipelineTransitionCommand;
      states.set(command.lead_id, { target: command.target_stage, kind: item.last_error?.startsWith("PIPELINE_CONFLICT:") ? "conflict" : "pending" });
    }
  }
  return states;
}

async function localSnapshot(segments: readonly PipelineSegment[], actorId: string) {
  const [localLeads, users, queue] = await Promise.all([db.leads.toArray(), db.users.toArray(), db.sync_queue.toArray()]);
  const names = new Map(users.map((user) => [user.user_id, user.name]));
  const allowed = new Set(segments);
  const visible = localLeads.filter((lead) => allowed.has(lead.segment_type)).map((lead) => asLeadView(lead, lead.assigned_to ? names.get(lead.assigned_to) ?? "Assigned employee" : "Unassigned"));
  const pendingCreations = queue
    .filter((item) => item.table_name === "leads" && item.action === "INSERT" && item.owner_user_id === actorId)
    .map((item) => visible.find((lead) => lead.lead_id === (item.data as { lead_id?: string }).lead_id))
    .filter(Boolean) as PendingLeadCreation[];
  return { visible, localLeads, pendingCreations, queue };
}

export async function fetchPipelineSnapshot(segments: readonly PipelineSegment[], actorId: string): Promise<PipelineSnapshot> {
  const local = await localSnapshot(segments, actorId);
  if (typeof navigator === "undefined" || !navigator.onLine) return { leads: local.visible, pending: pendingStateFromQueue(local.queue), degraded: true };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("No session");
    const response = await fetch("/api/pipeline/leads", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Pipeline read failed");
    let body = await response.json() as { leads: PipelineLeadView[]; recovery?: { operations?: ConfirmedPipelineOperation[]; safe_replay_targets?: PipelineStage[] } };
    let server = body.leads.filter((lead) => segments.includes(lead.segment_type));
    const recovery = await recoverOwnedLegacyPipelineStages({
      actorId, serverLeads: server, localLeads: local.localLeads, queue: local.queue,
      confirmedOperations: body.recovery?.operations ?? [], safeReplayTargets: body.recovery?.safe_replay_targets ?? [],
    }).catch(() => ({ autoRecoverable: 0, recovered: 0, alreadySatisfied: 0, reviewRequired: 0, noEvidence: 0, serverChanged: false }));
    if (recovery.serverChanged) {
      const refreshed = await fetch("/api/pipeline/leads", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!refreshed.ok) throw new Error("Pipeline recovery refresh failed");
      body = await refreshed.json();
      server = body.leads.filter((lead) => segments.includes(lead.segment_type));
    }
    if (server.length) await db.leads.bulkPut(server);
    const currentQueue = await db.sync_queue.toArray();
    return { leads: mergeAuthoritativePipeline(server, local.pendingCreations), pending: pendingStateFromQueue(currentQueue), degraded: false };
  } catch {
    return { leads: local.visible, pending: pendingStateFromQueue(local.queue), degraded: true };
  }
}
