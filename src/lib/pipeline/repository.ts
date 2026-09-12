import { db, type LocalLead, type SyncQueueItem } from "../db";
import Dexie from "dexie";
import { supabase } from "../supabaseClient";
import { mergeAuthoritativePipeline, type PendingLeadCreation } from "./authority";
import { PIPELINE_CREATE_QUEUE_TABLE, PIPELINE_TRANSITION_QUEUE_TABLE, type PipelineCreateCommand, type PipelineLeadView, type PipelineSegment, type PipelineTransitionCommand } from "./contract";
import { isLegacyPipelineStatusMutation } from "./legacyQueue";
import { recoverOwnedLegacyPipelineStages } from "./legacyRecoveryRuntime";
import type { ConfirmedPipelineOperation } from "./legacyRecovery";
import type { PipelineStage } from "../pipelineStages";
import { EMPTY_PIPELINE_FILTERS, type PipelineFilters } from "./salesReview";

export interface PipelinePendingState {
  target: string;
  kind: "pending" | "conflict" | "legacy" | "review";
}

export interface PipelineSnapshot {
  leads: PipelineLeadView[];
  pending: Map<string, PipelinePendingState>;
  authorityState: "server" | "offline" | "error";
  page: number;
  total: number;
  hasMore: boolean;
  stages: Array<{ stage: string; count: number }> | null;
  filters: PipelineFilters;
  pendingCreationIds: string[];
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
      states.set(command.lead_id, { target: command.target_stage, kind: item.recovery_state ? "review" : item.last_error?.startsWith("PIPELINE_CONFLICT:") ? "conflict" : "pending" });
    }
  }
  return states;
}

async function localSnapshot(selectedSegment: PipelineSegment, actorId: string, page: number) {
  const collection = () => db.leads.where("[segment_type+created_at+lead_id]").between([selectedSegment, Dexie.minKey, Dexie.minKey], [selectedSegment, Dexie.maxKey, Dexie.maxKey]);
  const [localLeads, total, users, queue] = await Promise.all([
    collection().reverse().offset((page - 1) * 50).limit(50).toArray(), collection().count(), db.users.toArray(),
    db.sync_queue.where("table_name").anyOf("leads", PIPELINE_CREATE_QUEUE_TABLE, PIPELINE_TRANSITION_QUEUE_TABLE).toArray(),
  ]);
  const names = new Map(users.map((user) => [user.user_id, user.name]));
  const rejectedCreationIds = new Set(queue
    .filter((item) => (item.table_name === "leads" || item.table_name === PIPELINE_CREATE_QUEUE_TABLE) && item.action === "INSERT" && Boolean(item.recovery_state))
    .map((item) => (item.data as PipelineCreateCommand | { lead_id?: string }).lead_id)
    .filter((id): id is string => Boolean(id)));
  const visible = localLeads.filter((lead) => !rejectedCreationIds.has(lead.lead_id)).map((lead) => asLeadView(lead, lead.assigned_to ? names.get(lead.assigned_to) ?? "Assigned employee" : "Unassigned"));
  const pendingIds = queue
    .filter((item) => (item.table_name === "leads" || item.table_name === PIPELINE_CREATE_QUEUE_TABLE) && item.action === "INSERT" && item.owner_user_id === actorId && !item.recovery_state)
    .map((item) => (item.data as PipelineCreateCommand | { lead_id?: string }).lead_id).filter((id): id is string => Boolean(id));
  const pendingCreations = (await db.leads.bulkGet(pendingIds)).filter((lead): lead is LocalLead => lead !== undefined && lead.segment_type === selectedSegment).map((lead) => asLeadView(lead, lead.assigned_to ? names.get(lead.assigned_to) ?? "Assigned employee" : "Unassigned")) as PendingLeadCreation[];
  return { visible, pendingCreations, queue, total };
}

export async function fetchPipelineSnapshot(segments: readonly PipelineSegment[], actorId: string, page = 1, selectedSegment: PipelineSegment = "Retailer", filters: PipelineFilters = EMPTY_PIPELINE_FILTERS, signal?: AbortSignal): Promise<PipelineSnapshot> {
  const local = await localSnapshot(selectedSegment, actorId, page);
  const matches = (lead: PipelineLeadView) => (!filters.stage || lead.status === filters.stage) && (!filters.owner || lead.assigned_to === filters.owner)
    && (!filters.source || lead.lead_source === filters.source) && (!filters.search || [lead.business_name, lead.contact_person, lead.phone, lead.area].some(value => value?.toLowerCase().includes(filters.search.toLowerCase())));
  const fallback = { leads: local.visible.filter(matches), pending: pendingStateFromQueue(local.queue), page, total: local.total, hasMore: page * 50 < local.total,
    filters, stages: null, pendingCreationIds: local.pendingCreations.map(row => row.lead_id) };
  if (typeof navigator === "undefined" || !navigator.onLine) return { ...fallback, authorityState: "offline" };
  try {
    signal?.throwIfAborted();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token || data.session?.user.id !== actorId) throw new Error("No matching session");
    signal?.throwIfAborted();
    const query = new URLSearchParams({ page: String(page), pageSize: "50", segment: selectedSegment });
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    const response = await fetch(`/api/pipeline/leads?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
    if (!response.ok) throw new Error("Pipeline read failed");
    let body = await response.json() as { leads: PipelineLeadView[]; page: number; total: number; has_more: boolean; filters?: PipelineFilters; stages?: Array<{ stage: string; count: number }> | null; recovery?: { operations?: ConfirmedPipelineOperation[]; safe_replay_targets?: PipelineStage[] } };
    const validate = () => {
      if (body.page !== page || !Number.isSafeInteger(body.total) || body.total < 0 || typeof body.has_more !== "boolean" || !Array.isArray(body.leads) || body.leads.length > 50
        || new Set(body.leads.map(lead => lead.lead_id)).size !== body.leads.length || body.leads.some(lead => lead.segment_type !== selectedSegment || !matches(lead))
        || (body.filters && Object.keys(filters).some(key => body.filters![key as keyof PipelineFilters] !== filters[key as keyof PipelineFilters]))) throw new Error("Pipeline scope mismatch");
    };
    validate();
    let server = body.leads.filter((lead) => segments.includes(lead.segment_type));
    const recoveryLocalLeads = (await db.leads.bulkGet(server.map((lead) => lead.lead_id))).filter((lead): lead is LocalLead => Boolean(lead));
    const recovery = await recoverOwnedLegacyPipelineStages({
      actorId, serverLeads: server, localLeads: recoveryLocalLeads, queue: local.queue,
      confirmedOperations: body.recovery?.operations ?? [], safeReplayTargets: body.recovery?.safe_replay_targets ?? [],
    }).catch(() => ({ autoRecoverable: 0, recovered: 0, alreadySatisfied: 0, reviewRequired: 0, noEvidence: 0, serverChanged: false }));
    if (recovery.serverChanged) {
      const refreshed = await fetch(`/api/pipeline/leads?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal });
      if (!refreshed.ok) throw new Error("Pipeline recovery refresh failed");
      body = await refreshed.json();
      validate();
      server = body.leads.filter((lead) => segments.includes(lead.segment_type));
    }
    if (server.length) await db.leads.bulkPut(server);
    const currentQueue = await db.sync_queue.toArray();
    const pendingCreations = local.pendingCreations.filter(matches).filter(row => !server.some(confirmed => confirmed.lead_id === row.lead_id));
    return { leads: mergeAuthoritativePipeline(server, pendingCreations), pending: pendingStateFromQueue(currentQueue), authorityState: "server", page: body.page, total: body.total, hasMore: body.has_more,
      filters: body.filters ?? filters, stages: body.stages ?? null, pendingCreationIds: pendingCreations.map(row => row.lead_id) };
  } catch {
    return { ...fallback, authorityState: "error" };
  }
}
