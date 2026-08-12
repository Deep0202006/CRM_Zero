import type { PipelineLeadView } from "./contract";

export interface PendingLeadCreation extends PipelineLeadView {
  pending_creation?: true;
}

export function mergeAuthoritativePipeline(
  serverLeads: PipelineLeadView[],
  pendingCreations: PendingLeadCreation[],
): PipelineLeadView[] {
  const byId = new Map<string, PipelineLeadView>();
  for (const pending of pendingCreations) byId.set(pending.lead_id, pending);
  for (const server of serverLeads) byId.set(server.lead_id, server);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
