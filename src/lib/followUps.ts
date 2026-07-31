import type { LocalTask, LocalTaskTemplate } from "./db";

export const SCHEDULED_CALL_FOLLOWUP_MARKER = "Scheduled follow-up for:";
export const CALL_FOLLOWUP_OUTCOMES = [
  "No response (followup)",
  "Requested more info",
] as const;

const FOLLOWUP_LIKE_PATTERN = /follow[\s-]?up|re-engage|call again/i;

export function isFollowUpLikeText(title: string | null, description: string | null): boolean {
  return FOLLOWUP_LIKE_PATTERN.test(`${title ?? ""} ${description ?? ""}`);
}

export function isFollowUpLikeTemplate(template: Pick<LocalTaskTemplate, "title" | "description">): boolean {
  return isFollowUpLikeText(template.title, template.description);
}

export function needsCallFollowUp(outcome: string): boolean {
  return (CALL_FOLLOWUP_OUTCOMES as readonly string[]).includes(outcome);
}

export function isValidSelfScheduledFollowUp(
  task: LocalTask,
  authenticatedUserId: string,
): boolean {
  return (
    task.source === "manual" &&
    task.assigned_to === authenticatedUserId &&
    task.assigned_by === authenticatedUserId &&
    Boolean(task.due_date) &&
    task.template_id === null &&
    Boolean(task.description?.includes(SCHEDULED_CALL_FOLLOWUP_MARKER))
  );
}

export function buildSelfScheduledFollowUpTask(input: {
  outcome: string;
  dueDate: string | null;
  authenticatedUserId: string;
  taskId: string;
  clientDisplay: string;
  related_lead_id: string | null;
  notes: string;
  createdAt: string;
}): LocalTask | null {
  if (!needsCallFollowUp(input.outcome) || !input.dueDate) return null;
  return {
    task_id: input.taskId,
    assigned_to: input.authenticatedUserId,
    assigned_by: input.authenticatedUserId,
    title: "Follow-up Call",
    description: `${SCHEDULED_CALL_FOLLOWUP_MARKER} ${input.clientDisplay}\nNotes: ${input.notes || "No notes"}`,
    priority: "High",
    status: "Pending",
    source: "manual",
    template_id: null,
    related_lead_id: input.related_lead_id,
    due_date: input.dueDate,
    started_at: null,
    completed_at: null,
    proof_note: null,
    proof_photo_url: null,
    created_at: input.createdAt,
  };
}
