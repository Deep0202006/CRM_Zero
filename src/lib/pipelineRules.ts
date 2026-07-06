// src/lib/pipelineRules.ts — THE single source of truth. Every other file
// (validation.ts, any SQL trigger, any component) must import from here,
// never redefine its own copy of this list.

export const PIPELINE_STAGES = [
  "New", "Contacted", "Interested", "Not Interested",
  "Registration", "Installation", "Payment", "Renewal Due",
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

// These stages indicate a lead has successfully converted (moved past "Interested")
export const CONVERTED_STAGES: PipelineStage[] = [
  "Registration", "Installation", "Payment", "Renewal Due"
];

// Each entry: [from, to, allowedBy] — allowedBy documents WHO can trigger it,
// which is what the last two bugs actually needed and didn't have recorded.
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
