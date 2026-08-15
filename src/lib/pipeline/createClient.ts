import type { ExistingPipelineLead, PipelineCreateCommand, PipelineLeadView } from "./contract";

export type PipelineCreateConfirmation =
  | { status: "confirmed"; code: "LEAD_CREATED" | "LEAD_ALREADY_CONFIRMED"; lead: PipelineLeadView }
  | { status: "duplicate"; code: "LEAD_ALREADY_EXISTS"; existing: ExistingPipelineLead }
  | { status: "pending"; code: string }
  | { status: "rejected"; code: string; message: string };

export async function sendPipelineCreate(command: PipelineCreateCommand, accessToken: string): Promise<PipelineCreateConfirmation> {
  let response: Response;
  try {
    response = await fetch("/api/pipeline/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
    });
  } catch {
    return { status: "pending", code: "PIPELINE_CREATE_UNAVAILABLE" };
  }
  let result: { code?: string; message?: string; operation_id?: string; lead?: PipelineLeadView; existing?: ExistingPipelineLead };
  try { result = await response.json() as typeof result; }
  catch { return { status: "pending", code: "PIPELINE_CREATE_UNREADABLE" }; }
  if (response.status === 409 && result.code === "LEAD_ALREADY_EXISTS" && result.existing) {
    return { status: "duplicate", code: "LEAD_ALREADY_EXISTS", existing: result.existing };
  }
  if (response.ok && result.lead && result.operation_id === command.operation_id && (result.code === "LEAD_CREATED" || result.code === "LEAD_ALREADY_CONFIRMED")) {
    return { status: "confirmed", code: result.code, lead: result.lead };
  }
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return { status: "pending", code: result.code ?? "PIPELINE_CREATE_UNAVAILABLE" };
  }
  return { status: "rejected", code: result.code ?? "PIPELINE_CREATE_REJECTED", message: result.message ?? "Lead creation was rejected." };
}
