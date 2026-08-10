import { ALLOWED_TRANSITIONS, PIPELINE_STAGES, type PipelineStage } from "../pipelineStages";

export type PipelineActor = "employee" | "system";
export type PipelineSegment = "Distributor" | "Retailer";

export interface PipelineTransitionCommand {
  operation_id: string;
  lead_id: string;
  expected_stage: PipelineStage;
  target_stage: PipelineStage;
  actor_id: string;
  created_at: string;
}

export interface PipelineLeadView {
  lead_id: string;
  business_name: string;
  contact_person: string;
  phone: string;
  segment_type: PipelineSegment;
  status: PipelineStage;
  assigned_to: string | null;
  owner_name: string;
  created_at: string;
  stage_entered_at?: string | null;
  onboarded_at?: string | null;
  lead_source?: string;
  area?: string;
}

export const PIPELINE_TRANSITION_QUEUE_TABLE = "pipeline_transition_commands";

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

export function canEmployeeTransition(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED_TRANSITIONS.some((transition) => transition.from === from && transition.to === to && transition.allowedBy === "agent");
}

export function canSystemTransition(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

export function assertOwnerTransition(command: PipelineTransitionCommand, assignedTo: string | null): void {
  if (!assignedTo || command.actor_id !== assignedTo) throw new Error("PIPELINE_NOT_ASSIGNED");
  if (!canEmployeeTransition(command.expected_stage, command.target_stage)) throw new Error("PIPELINE_INVALID_TRANSITION");
}

export function getEmployeeTransitionActions(stage: PipelineStage) {
  return ALLOWED_TRANSITIONS.filter((transition) => transition.from === stage && transition.allowedBy === "agent");
}
