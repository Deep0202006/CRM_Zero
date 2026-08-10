import type { PipelineLeadView, PipelineSegment } from "./contract";

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

export function segmentsFromCapabilities(capabilities: readonly string[]): PipelineSegment[] {
  if (capabilities.includes("admin")) return ["Retailer", "Distributor"];
  const segments: PipelineSegment[] = [];
  if (capabilities.includes("ret_onboarding")) segments.push("Retailer");
  if (capabilities.includes("dist_onboarding")) segments.push("Distributor");
  return segments;
}

export function filterPipelineSegments(leads: PipelineLeadView[], segments: readonly PipelineSegment[]) {
  const allowed = new Set(segments);
  return leads.filter((lead) => allowed.has(lead.segment_type));
}
