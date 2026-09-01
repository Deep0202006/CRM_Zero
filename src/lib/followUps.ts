import type { LocalTask, LocalTaskTemplate } from "./db";

export const SCHEDULED_CALL_FOLLOWUP_MARKER = "Scheduled follow-up for:";
export const FOLLOWUP_SOURCE_CALL_PREFIX = "[ZD_FOLLOWUP_SOURCE_CALL:";
const FOLLOWUP_SOURCE_CALL_PATTERN = /\[ZD_FOLLOWUP_SOURCE_CALL:([0-9a-f-]{36})\]/i;
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

export function createFollowUpSourceCallMarker(callLogId: string): string {
  return `${FOLLOWUP_SOURCE_CALL_PREFIX}${callLogId}]`;
}

export function parseFollowUpSourceCallId(description: string | null): string | null {
  return description?.match(FOLLOWUP_SOURCE_CALL_PATTERN)?.[1] ?? null;
}

export function stripInternalFollowUpMarkers(description: string | null): string | null {
  if (!description) return description;
  return description.replace(FOLLOWUP_SOURCE_CALL_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
}

function normalize(value: string | null): string {
  return (stripInternalFollowUpMarkers(value) ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildFollowUpLogicalKey(task: LocalTask): string {
  const sourceCallId = parseFollowUpSourceCallId(task.description);
  if (sourceCallId) return `call:${sourceCallId}`;
  return [
    "legacy",
    task.assigned_to,
    task.assigned_by ?? "",
    task.due_date,
    task.related_lead_id ?? "",
    normalize(task.title),
    normalize(task.description),
  ].join("|");
}

export function deduplicateSelfScheduledFollowUps(tasks: LocalTask[], authenticatedUserId: string): LocalTask[] {
  const output: LocalTask[] = [];
  const canonicalByKey = new Map<string, number>();
  for (const task of tasks) {
    if (!isValidSelfScheduledFollowUp(task, authenticatedUserId)) {
      output.push(task);
      continue;
    }
    const key = buildFollowUpLogicalKey(task);
    const existingIndex = canonicalByKey.get(key);
    if (existingIndex === undefined) {
      canonicalByKey.set(key, output.length);
      output.push(task);
      continue;
    }
    const existing = output[existingIndex];
    const hasSourceMarker = Boolean(parseFollowUpSourceCallId(task.description));
    const withinLegacyWindow =
      Math.abs(new Date(existing.created_at).getTime() - new Date(task.created_at).getTime()) <= 60_000;
    if (!hasSourceMarker && !withinLegacyWindow) {
      canonicalByKey.set(`${key}|${task.task_id}`, output.length);
      output.push(task);
      continue;
    }
    const taskWins =
      (task.status === "Completed" && existing.status !== "Completed") ||
      (task.status === existing.status && task.created_at < existing.created_at);
    if (taskWins) output[existingIndex] = task;
  }
  return output;
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
  sourceCallId: string;
}): LocalTask | null {
  if (!needsCallFollowUp(input.outcome) || !input.dueDate) return null;
  return {
    task_id: input.taskId,
    assigned_to: input.authenticatedUserId,
    assigned_by: input.authenticatedUserId,
    title: "Follow-up Call",
    description: `${SCHEDULED_CALL_FOLLOWUP_MARKER} ${input.clientDisplay}\n${createFollowUpSourceCallMarker(input.sourceCallId)}\nNotes: ${input.notes || "No notes"}`,
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

export function reconcileCallFollowUpTasks(input: {
  existingTasks: LocalTask[];
  outcome: string;
  dueDate: string | null;
  authenticatedUserId: string;
  newTaskId: string;
  clientDisplay: string;
  relatedLeadId: string | null;
  notes: string;
  changedAt: string;
  sourceCallId: string;
}): LocalTask[] {
  const active = input.existingTasks
    .filter((task) => parseFollowUpSourceCallId(task.description) === input.sourceCallId)
    .filter((task) => task.is_active !== false && task.status !== "Completed" && task.status !== "Missed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id));
  const cancel = (task: LocalTask): LocalTask => ({
    ...task,
    is_active: false,
    cancelled_at: input.changedAt,
    cancellation_reason: "Source Call no longer requires this active follow-up.",
  });

  if (!needsCallFollowUp(input.outcome) || !input.dueDate) return active.map(cancel);

  const refreshed = buildSelfScheduledFollowUpTask({
    outcome: input.outcome,
    dueDate: input.dueDate,
    authenticatedUserId: input.authenticatedUserId,
    taskId: active[0]?.task_id ?? input.newTaskId,
    clientDisplay: input.clientDisplay,
    related_lead_id: input.relatedLeadId,
    notes: input.notes,
    createdAt: active[0]?.created_at ?? input.changedAt,
    sourceCallId: input.sourceCallId,
  });
  if (!refreshed) return active.map(cancel);
  const current = active[0];
  return [
    current ? {
      ...current,
      title: refreshed.title,
      description: refreshed.description,
      priority: refreshed.priority,
      related_lead_id: refreshed.related_lead_id,
      due_date: refreshed.due_date,
      is_active: true,
      cancelled_at: null,
      cancellation_reason: null,
    } : refreshed,
    ...active.slice(1).map(cancel),
  ];
}
