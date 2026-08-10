import { createPipelineServerContext, validateTransitionCommand } from "../server";

export async function POST(request: Request) {
  const context = await createPipelineServerContext(request);
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  let command: unknown;
  try { command = await request.json(); } catch { return Response.json({ code: "PIPELINE_INVALID_COMMAND" }, { status: 400 }); }
  if (!validateTransitionCommand(command) || command.actor_id !== context.userId) return Response.json({ code: "PIPELINE_INVALID_COMMAND" }, { status: 400 });

  const { data, error } = await context.service.rpc("transition_lead_stage_v2", {
    p_operation_id: command.operation_id,
    p_lead_id: command.lead_id,
    p_expected_stage: command.expected_stage,
    p_target_stage: command.target_stage,
    p_actor_id: context.userId,
  });
  if (error) return Response.json({ code: "PIPELINE_CONFIGURATION", message: "Pipeline confirmation is not available." }, { status: 503 });
  const result = data as { success?: boolean; code?: string; current_stage?: string; lead?: unknown; operation_id?: string } | null;
  if (!result?.success) {
    const status = result?.code === "PIPELINE_CONFLICT" ? 409 : result?.code === "PIPELINE_NOT_ASSIGNED" ? 403 : 422;
    return Response.json(result ?? { code: "PIPELINE_REJECTED" }, { status });
  }
  const rawLead = result.lead as Record<string, unknown> | undefined;
  if (!rawLead) return Response.json({ code: "PIPELINE_INVALID_CONFIRMATION" }, { status: 502 });
  const lead = {
    lead_id: rawLead.lead_id,
    business_name: rawLead.business_name,
    contact_person: rawLead.contact_person,
    phone: rawLead.phone,
    segment_type: rawLead.segment_type,
    status: rawLead.status,
    assigned_to: rawLead.assigned_to,
    owner_name: rawLead.owner_name,
    created_at: rawLead.created_at,
    stage_entered_at: rawLead.stage_entered_at,
    onboarded_at: rawLead.onboarded_at,
    lead_source: rawLead.lead_source,
    area: rawLead.area,
  };
  return Response.json({ success: true, operation_id: result.operation_id, lead });
}
