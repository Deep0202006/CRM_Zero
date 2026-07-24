// src/lib/pipelineStages.ts

export const PIPELINE_STAGES = [
  "New", 
  "Contacted", 
  "Interested", 
  "Not Interested",
  "Registration", 
  "Installation", 
  "Payment", 
  "Renewal Due"
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

export const CONVERTED_STAGES: PipelineStage[] = [
  "Registration", "Installation", "Payment", "Renewal Due"
];

// Each entry: [from, to, allowedBy] — allowedBy documents WHO can trigger it
export const ALLOWED_TRANSITIONS: Array<{ from: PipelineStage; to: PipelineStage; allowedBy: "agent" | "system" }> = [
  { from: "New", to: "Contacted", allowedBy: "agent" },
  { from: "Contacted", to: "Interested", allowedBy: "agent" },
  { from: "Contacted", to: "Not Interested", allowedBy: "agent" },
  { from: "Interested", to: "Registration", allowedBy: "agent" },
  { from: "Not Interested", to: "Contacted", allowedBy: "agent" }, // re-engagement
  { from: "Registration", to: "Installation", allowedBy: "agent" }, // gated on checklist
  { from: "Installation", to: "Payment", allowedBy: "agent" },
  { from: "Payment", to: "Renewal Due", allowedBy: "system" }, // ONLY the nightly cron
  { from: "Renewal Due", to: "Payment", allowedBy: "agent" }, // renewed
  { from: "Renewal Due", to: "Not Interested", allowedBy: "agent" }, // churned
];

export function isTransitionAllowed(from: PipelineStage, to: PipelineStage, actor: "agent" | "system"): boolean {
  return ALLOWED_TRANSITIONS.some((t) => t.from === from && t.to === to && (t.allowedBy === actor || actor === "system"));
}

export function getNextPipelineStage(currentStage: PipelineStage): PipelineStage | null {
  const transitions = ALLOWED_TRANSITIONS.filter(t => t.from === currentStage && t.allowedBy === "agent" && t.to !== "Not Interested");
  if (transitions.length === 1) return transitions[0].to;
  // If multiple valid forward stages, pick the primary progression one
  if (currentStage === "Contacted") return "Interested";
  if (currentStage === "Renewal Due") return "Payment";
  return transitions.length > 0 ? transitions[0].to : null;
}

export function getPreviousPipelineStage(currentStage: PipelineStage): PipelineStage | null {

  // For standard linear reverse logic
  if (currentStage === "Interested") return "Contacted";
  if (currentStage === "Registration") return "Interested";
  if (currentStage === "Installation") return "Registration";
  if (currentStage === "Payment") return "Installation";
  if (currentStage === "Contacted") return "New";
  return null;
}

export function isValidStageTransition(from: PipelineStage, to: PipelineStage): boolean {
  return isTransitionAllowed(from, to, "agent");
}
