import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PipelineLeadView, PipelineSegment, PipelineTransitionCommand } from "@/lib/pipeline/contract";
import { isPipelineStage } from "@/lib/pipeline/contract";
import type { ConfirmedPipelineOperation } from "@/lib/pipeline/legacyRecovery";

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

export async function createPipelineServerContext(request: Request): Promise<PipelineServerContext | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = bearerToken(request);
  if (!url || !anon || !serviceKey || !token) return null;
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authenticated, error } = await auth.auth.getUser(token);
  if (error || !authenticated.user) return null;
  const userId = authenticated.user.id;
  const { data: user } = await service.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle();
  if (!user || !(user.is_active === true || user.is_active === 1)) return null;
  return { userId, segments: ["Retailer", "Distributor"], userClient: auth, service };
}

export async function readAuthorizedPipeline(context: PipelineServerContext, page: number, pageSize: number, segment: PipelineSegment): Promise<{ leads: PipelineLeadView[]; total: number }> {
  const start = (page - 1) * pageSize;
  const { data: leads, error, count } = await context.service
    .from("leads")
    .select("lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,onboarded_at,lead_source,area", { count: "exact" })
    .eq("segment_type", segment)
    .order("created_at", { ascending: false })
    .order("lead_id", { ascending: false })
    .range(start, start + pageSize - 1);
  if (error) throw error;
  const ownerIds = [...new Set((leads ?? []).map((lead) => lead.assigned_to).filter(Boolean))];
  const { data: owners, error: ownerError } = ownerIds.length
    ? await context.service.from("users").select("user_id,name").in("user_id", ownerIds)
    : { data: [], error: null };
  if (ownerError) throw ownerError;
  const names = new Map((owners ?? []).map((owner) => [owner.user_id, owner.name]));
  return { leads: (leads ?? []).filter((lead) => isPipelineStage(lead.status)).map((lead) => ({ ...lead, owner_name: names.get(lead.assigned_to) ?? "Unassigned" })) as PipelineLeadView[], total: count ?? 0 };
}

export async function readOwnedPipelineOperationEvidence(context: PipelineServerContext, leads: PipelineLeadView[]): Promise<ConfirmedPipelineOperation[]> {
  const ownedLeadIds = leads.filter((lead) => lead.assigned_to === context.userId).map((lead) => lead.lead_id);
  if (ownedLeadIds.length === 0) return [];
  const { data, error } = await context.service
    .from("pipeline_transition_operations")
    .select("operation_id,lead_id,actor_id,expected_stage,target_stage,confirmed_at")
    .eq("actor_id", context.userId)
    .in("lead_id", ownedLeadIds)
    .order("confirmed_at", { ascending: true });
  if (error) throw error;
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
