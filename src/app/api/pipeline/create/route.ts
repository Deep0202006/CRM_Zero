import { createPipelineServerContext, validateCreateCommand } from "../server";

export async function POST(request: Request) {
  const context = await createPipelineServerContext(request);
  if (context instanceof Response) return context;
  if (!context) return Response.json({ code: "PIPELINE_UNAUTHORIZED" }, { status: 401 });
  let command: unknown;
  try { command = await request.json(); }
  catch { return Response.json({ code: "PIPELINE_INVALID_CREATE" }, { status: 400 }); }
  if (!validateCreateCommand(command) || command.actor_id !== context.userId) {
    return Response.json({ code: "PIPELINE_INVALID_CREATE" }, { status: 400 });
  }
  const { data, error } = await context.service.rpc("pipeline_create_lead_v1", {
    p_operation_id: command.operation_id,
    p_lead_id: command.lead_id,
    p_actor_id: context.userId,
    p_business_name: command.business_name,
    p_contact_person: command.contact_person,
    p_phone: command.phone,
    p_segment_type: command.segment_type,
    p_lead_source: command.lead_source,
    p_area: command.area ?? null,
    p_created_at: command.created_at,
  });
  if (error) return Response.json({ code: "PIPELINE_CREATE_CONFIGURATION", message: "Lead creation is not available." }, { status: 503 });
  const result = data as { success?: boolean; code?: string; operation_id?: string; lead?: unknown; existing?: unknown } | null;
  if (!result?.success) {
    const status = result?.code === "LEAD_ALREADY_EXISTS" ? 409
      : result?.code === "PIPELINE_ACTOR_INACTIVE" ? 403
      : result?.code === "PIPELINE_OPERATION_MISMATCH" ? 409
      : 422;
    return Response.json(result ?? { code: "PIPELINE_CREATE_REJECTED" }, { status });
  }
  return Response.json(result, { status: result.code === "LEAD_CREATED" ? 201 : 200 });
}
