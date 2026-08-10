import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { segmentsFromCapabilities } from "@/lib/pipeline/authority";
import type { PipelineLeadView, PipelineSegment, PipelineTransitionCommand } from "@/lib/pipeline/contract";
import { isPipelineStage } from "@/lib/pipeline/contract";

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
  const [{ data: user }, { data: grants }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", userId),
  ]);
  if (!user || !(user.is_active === true || user.is_active === 1)) return null;
  return { userId, segments: segmentsFromCapabilities((grants ?? []).map((grant) => grant.capability_code)), userClient: auth, service };
}

export async function readAuthorizedPipeline(context: PipelineServerContext): Promise<PipelineLeadView[]> {
  if (context.segments.length === 0) return [];
  // The authenticated client preserves the deployed RLS visibility boundary;
  // segment capabilities can narrow it but never broaden it.
  const { data: leads, error } = await context.userClient
    .from("leads")
    .select("lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,onboarded_at,lead_source,area")
    .in("segment_type", context.segments)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ownerIds = [...new Set((leads ?? []).map((lead) => lead.assigned_to).filter(Boolean))];
  const { data: owners, error: ownerError } = ownerIds.length
    ? await context.service.from("users").select("user_id,name").in("user_id", ownerIds)
    : { data: [], error: null };
  if (ownerError) throw ownerError;
  const names = new Map((owners ?? []).map((owner) => [owner.user_id, owner.name]));
  return (leads ?? []).filter((lead) => isPipelineStage(lead.status)).map((lead) => ({ ...lead, owner_name: names.get(lead.assigned_to) ?? "Unassigned" })) as PipelineLeadView[];
}

export function validateTransitionCommand(value: unknown): value is PipelineTransitionCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  return typeof command.operation_id === "string" && typeof command.lead_id === "string" && typeof command.actor_id === "string" && typeof command.created_at === "string" && isPipelineStage(command.expected_stage) && isPipelineStage(command.target_stage);
}
