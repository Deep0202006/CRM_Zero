import type { SupabaseClient } from "@supabase/supabase-js";
import { backendUnavailableResponse, createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import type { PipelineCreateCommand, PipelineLeadView, PipelineSegment, PipelineTransitionCommand } from "@/lib/pipeline/contract";
import { isPipelineStage } from "@/lib/pipeline/contract";
import type { ConfirmedPipelineOperation } from "@/lib/pipeline/legacyRecovery";
import type { ReportResource } from "@/lib/analytics/reportResource";
import { EMPTY_PIPELINE_FILTERS, pipelineRegisterSchema, orderedStageCounts, type PipelineFilters } from "@/lib/pipeline/salesReview";

export interface PipelineServerContext {
  userId: string;
  segments: PipelineSegment[];
  userClient: SupabaseClient;
  service: SupabaseClient;
}

export function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : null;
}

export async function createPipelineServerContext(request: Request, resource?: ReportResource): Promise<PipelineServerContext | Response | null> {
  resource?.check();
  const authResult = createServerAnonClient(), serviceResult = createServerServiceClient(resource ? { fetch: resource.fetch } : undefined);
  if (!authResult.ok || !serviceResult.ok) return backendUnavailableResponse();
  const token = bearerToken(request);
  if (!token) return null;
  const auth = authResult.client, service = serviceResult.client;
  const { data: authenticated, error } = await (resource ? service : auth).auth.getUser(token);
  resource?.check();
  if (error || !authenticated.user) return null;
  const userId = authenticated.user.id;
  const query = service.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle();
  const { data: user } = await (resource ? resource.read(query, true) : query);
  if (!user || !(user.is_active === true || user.is_active === 1)) return null;
  return { userId, segments: ["Retailer", "Distributor"], userClient: auth, service };
}

export async function readAuthorizedPipeline(context: PipelineServerContext, page: number, pageSize: number, segment: PipelineSegment, filters: PipelineFilters = EMPTY_PIPELINE_FILTERS, resource?: ReportResource): Promise<{ leads: PipelineLeadView[]; total: number; stages: Array<{ stage: string; count: number }> | null }> {
  if (resource) {
    const result = await resource.read(context.service.rpc("crm_pipeline_register_v1", {
      p_segment: segment, p_search: filters.search, p_owner: filters.owner || null, p_source: filters.source || null,
      p_stage: filters.stage || null, p_page: page, p_page_size: pageSize,
    }));
    if (!result.error) {
      const parsed = pipelineRegisterSchema.parse(result.data);
      if (parsed.page !== page || parsed.page_size !== pageSize || parsed.leads.some(lead => lead.segment_type !== segment || (filters.stage && lead.status !== filters.stage) || (filters.owner && lead.assigned_to !== filters.owner))) throw new Error("PIPELINE_SCOPE_MISMATCH");
      return { leads: parsed.leads, total: parsed.total, stages: orderedStageCounts(parsed.stages.map(row => ({ status: row.stage, lead_count: row.count }))) };
    }
    // Unapplied additive SQL must not remove existing unfiltered browsing/actions.
    if (!["PGRST202", "42883"].includes(result.error.code) || Object.values(filters).some(Boolean)) throw result.error;
  }
  const start = (page - 1) * pageSize;
  const query = context.service
    .from("leads")
    .select("lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,onboarded_at,lead_source,area", { count: "exact" })
    .eq("segment_type", segment)
    .order("created_at", { ascending: false })
    .order("lead_id", { ascending: false })
    .range(start, start + pageSize - 1);
  const { data: leads, error, count } = await (resource ? resource.read(query) : query);
  if (error) throw error;
  const ownerIds = [...new Set((leads ?? []).map((lead) => lead.assigned_to).filter(Boolean))];
  const ownerQuery = context.service.from("users").select("user_id,name").in("user_id", ownerIds).limit(50);
  const { data: owners, error: ownerError } = ownerIds.length ? await (resource ? resource.read(ownerQuery) : ownerQuery) : { data: [], error: null };
  if (ownerError) throw ownerError;
  const names = new Map((owners ?? []).map((owner) => [owner.user_id, owner.name]));
  return { leads: (leads ?? []).map((lead) => ({ ...lead, owner_name: names.get(lead.assigned_to) ?? "Unassigned" })) as PipelineLeadView[], total: count ?? 0, stages: null };
}

export async function readOwnedPipelineOperationEvidence(context: PipelineServerContext, leads: PipelineLeadView[], resource?: ReportResource): Promise<ConfirmedPipelineOperation[]> {
  const ownedLeadIds = leads.filter((lead) => lead.assigned_to === context.userId).map((lead) => lead.lead_id);
  if (ownedLeadIds.length === 0) return [];
  if (ownedLeadIds.length > 50) throw new Error("RECOVERY_SCOPE_LIMIT");
  const query = context.service
    .from("pipeline_transition_operations")
    .select("operation_id,lead_id,actor_id,expected_stage,target_stage,confirmed_at", { count: "exact" })
    .eq("actor_id", context.userId)
    .in("lead_id", ownedLeadIds)
    .order("confirmed_at", { ascending: true }).order("operation_id").limit(1001);
  const { data, error, count } = await (resource ? resource.read(query) : query);
  if (error) throw error;
  if (count === null || count > 1000 || count !== data?.length) throw new Error("RECOVERY_EVIDENCE_UNAVAILABLE");
  return (data ?? []).filter((row) => isPipelineStage(row.expected_stage) && isPipelineStage(row.target_stage)).map((row) => ({
    operationId: row.operation_id,
    leadId: row.lead_id,
    actorId: row.actor_id,
    expectedStage: row.expected_stage,
    targetStage: row.target_stage,
    confirmedAt: row.confirmed_at,
  })) as ConfirmedPipelineOperation[];
}

export function validateTransitionCommand(value: unknown): value is PipelineTransitionCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  return typeof command.operation_id === "string" && typeof command.lead_id === "string" && typeof command.actor_id === "string" && typeof command.created_at === "string" && isPipelineStage(command.expected_stage) && isPipelineStage(command.target_stage);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateCreateCommand(value: unknown): value is PipelineCreateCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  return typeof command.operation_id === "string" && UUID.test(command.operation_id)
    && typeof command.lead_id === "string" && UUID.test(command.lead_id)
    && typeof command.actor_id === "string" && UUID.test(command.actor_id)
    && typeof command.business_name === "string" && command.business_name.trim().length > 0 && command.business_name.length <= 240
    && typeof command.contact_person === "string" && command.contact_person.trim().length > 0 && command.contact_person.length <= 240
    && typeof command.phone === "string" && command.phone.trim().length > 0 && command.phone.length <= 40
    && (command.segment_type === "Retailer" || command.segment_type === "Distributor")
    && typeof command.lead_source === "string" && command.lead_source.trim().length > 0 && command.lead_source.length <= 120
    && (command.area === undefined || command.area === null || (typeof command.area === "string" && command.area.length <= 240))
    && typeof command.created_at === "string" && Number.isFinite(Date.parse(command.created_at));
}
