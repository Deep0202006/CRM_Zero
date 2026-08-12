// src/lib/pipelineStages.ts

export const PIPELINE_STAGES = [
  "New", 
  "Contacted", 
  "Interested", 
  "Not Interested",
  "Registration", 
  "Installation", 
  "Payment", 
  "Converted",
  "Renewal Due"
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

export const CONVERTED_STAGES: PipelineStage[] = [
  "Registration", "Installation", "Payment", "Converted", "Renewal Due"
];

// Each entry: [from, to, allowedBy] — allowedBy documents WHO can trigger it
export const ALLOWED_TRANSITIONS: Array<{ from: PipelineStage; to: PipelineStage; allowedBy: "agent" | "system"; segment?: "Retailer" | "Distributor" }> = [
  { from: "New", to: "Contacted", allowedBy: "agent" },
  { from: "Contacted", to: "Interested", allowedBy: "agent" },
  { from: "Contacted", to: "Not Interested", allowedBy: "agent" },
  { from: "Interested", to: "Registration", allowedBy: "agent" },
  { from: "Not Interested", to: "Contacted", allowedBy: "agent" }, // re-engagement
  { from: "Registration", to: "Installation", allowedBy: "agent" }, // gated on checklist
  { from: "Installation", to: "Payment", allowedBy: "agent", segment: "Distributor" },
  { from: "Installation", to: "Converted", allowedBy: "agent", segment: "Retailer" },
  { from: "Payment", to: "Renewal Due", allowedBy: "system", segment: "Distributor" },
  { from: "Renewal Due", to: "Payment", allowedBy: "agent", segment: "Distributor" }, // renewed
  { from: "Renewal Due", to: "Converted", allowedBy: "agent", segment: "Retailer" },
  { from: "Renewal Due", to: "Not Interested", allowedBy: "agent" }, // churned
];

export type PipelineSegment = "Retailer" | "Distributor";

export const RETAILER_PIPELINE_STAGES = PIPELINE_STAGES.filter((stage) => stage !== "Payment");
export const DISTRIBUTOR_PIPELINE_STAGES = PIPELINE_STAGES.filter((stage) => stage !== "Converted");

export function stagesForSegment(segment: PipelineSegment): readonly PipelineStage[] {
  return segment === "Retailer" ? RETAILER_PIPELINE_STAGES : DISTRIBUTOR_PIPELINE_STAGES;
}

export function isTransitionAllowed(from: PipelineStage, to: PipelineStage, actor: "agent" | "system", segment?: PipelineSegment): boolean {
  return ALLOWED_TRANSITIONS.some((t) => t.from === from && t.to === to && (!t.segment || t.segment === segment) && (t.allowedBy === actor || actor === "system"));
}

export function getNextPipelineStage(currentStage: PipelineStage, segment?: PipelineSegment): PipelineStage | null {
  const transitions = ALLOWED_TRANSITIONS.filter(t => t.from === currentStage && t.allowedBy === "agent" && t.to !== "Not Interested" && (!t.segment || t.segment === segment));
  if (transitions.length === 1) return transitions[0].to;
  // If multiple valid forward stages, pick the primary progression one
  if (currentStage === "Contacted") return "Interested";
  if (currentStage === "Renewal Due" && segment === "Distributor") return "Payment";
  if (currentStage === "Renewal Due" && segment === "Retailer") return "Converted";
  return transitions.length > 0 ? transitions[0].to : null;
}

export function getPreviousPipelineStage(currentStage: PipelineStage): PipelineStage | null {

  // For standard linear reverse logic
  if (currentStage === "Interested") return "Contacted";
  if (currentStage === "Registration") return "Interested";
  if (currentStage === "Installation") return "Registration";
  if (currentStage === "Payment") return "Installation";
  if (currentStage === "Converted") return "Installation";
  if (currentStage === "Contacted") return "New";
  return null;
}

export function isValidStageTransition(from: PipelineStage, to: PipelineStage, segment?: PipelineSegment): boolean {
  return isTransitionAllowed(from, to, "agent", segment);
}
