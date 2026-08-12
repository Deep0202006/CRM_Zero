// src/lib/taskEngine.ts
// Task generation engine — runs right after login / clock-in.
// Checks whether today's tasks already exist for the user; if not, generates
// them from task_templates matching the user's active capabilities, writes to
// Dexie and queues for sync using the same sync_queue pattern as leads/attendance.

import { claimSyncQueueOwnership, db, transactionalMutation, type LocalTask, type LocalTaskTemplate } from "./db";
import {
  deduplicateSelfScheduledFollowUps,
  isFollowUpLikeTemplate,
  isFollowUpLikeText,
  isValidSelfScheduledFollowUp,
  parseFollowUpSourceCallId,
} from "./followUps";
import { getCurrentISTDate } from "./dateTime";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

export type { LocalTask, LocalTaskTemplate };

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function isProvenPipelineGeneratedTask(task: Pick<LocalTask, "assigned_by" | "source" | "related_lead_id" | "title" | "description">): boolean {
  if (task.assigned_by || task.source !== "manual" || !task.related_lead_id) return false;
  const title = task.title ?? ""; const description = task.description ?? "";
  const stage = "(?:Contacted|Interested|Not Interested|Registration|Installation|Payment|Converted|Renewal Due)";
  if (new RegExp(`^Lead moved to ${stage}\\. Follow up before it goes stale\\.$`).test(description) && new RegExp(`^Follow up: .+ \\(${stage}\\)$`).test(title)) return true;
  return description === "Required for registration." && /^(?:Collect GST certificate|Collect PAN card|Collect Drug Licence|Collect Bill Photo):/.test(title);
}

async function removeUnconfirmedInvalidTemplateFollowUps(userId: string): Promise<void> {
  const invalid = await db.tasks
    .where("assigned_to")
    .equals(userId)
    .filter(
      (task) =>
        task.source === "template" &&
        task.status !== "Completed" &&
        isFollowUpLikeText(task.title, task.description),
    )
    .toArray();
  for (const task of invalid) {
    const template = task.template_id ? await db.task_templates.get(task.template_id) : null;
    if (!template || !isFollowUpLikeTemplate(template)) continue;
    const [history, completionCall] = await Promise.all([
      db.task_status_history.where("task_id").equals(task.task_id).first(),
      db.call_logs.get(task.task_id),
    ]);
    if (history || completionCall) continue;
    const insert = await db.sync_queue
      .filter(
        (item) =>
          item.table_name === "tasks" &&
          item.action === "INSERT" &&
          (item.data as Partial<LocalTask>).task_id === task.task_id &&
          (item.owner_user_id === userId || !item.owner_user_id),
      )
      .first();
    if (!insert?.id) continue;
    if (!isSupabaseConfigured || typeof navigator === "undefined" || !navigator.onLine) continue;
    const { data: remoteTask, error: remoteCheckError } = await supabase
      .from("tasks")
      .select("task_id")
      .eq("task_id", task.task_id)
      .eq("assigned_to", userId)
      .maybeSingle();
    if (remoteCheckError || remoteTask) continue;
    await db.transaction("rw", [db.tasks, db.sync_queue], async () => {
      await db.sync_queue.delete(insert.id!);
      await db.tasks.delete(task.task_id);
    });
  }
}

async function selfHealCompletedFollowUps(userId: string): Promise<void> {
  const openTasks = await db.tasks
    .where("assigned_to")
    .equals(userId)
    .filter((task) => task.status !== "Completed" && isValidSelfScheduledFollowUp(task, userId))
    .toArray();
  for (const task of openTasks) {
    const [history, completionCall] = await Promise.all([
      db.task_status_history
        .where("task_id")
        .equals(task.task_id)
        .filter((row) => row.new_status === "Completed" && row.changed_by === userId)
        .sortBy("changed_at"),
      db.call_logs.get(task.task_id),
    ]);
    const markerBackedCompletionCall =
      parseFollowUpSourceCallId(task.description) && completionCall?.user_id === userId
        ? completionCall
        : null;
    const completionTimestamp = history[0]?.changed_at ?? markerBackedCompletionCall?.timestamp ?? null;
    if (!completionTimestamp) continue;
    const repair = { task_id: task.task_id, status: "Completed" as const, completed_at: completionTimestamp };
    await db.transaction("rw", [db.tasks, db.sync_queue], async () => {
      await db.tasks.update(task.task_id, repair);
      const existingRepair = await db.sync_queue
        .filter((item) => item.idempotency_key === `followup-self-heal:${task.task_id}`)
        .first();
      if (!existingRepair) {
        await db.sync_queue.add({
          table_name: "tasks",
          action: "UPDATE",
          owner_user_id: claimSyncQueueOwnership(),
          data: repair,
          timestamp: completionTimestamp,
          idempotency_key: `followup-self-heal:${task.task_id}`,
          retry_count: 0,
        });
      }
    });
  }
}

/**
 * Call once right after login (or right after clock-in on /attendance).
 * Returns today's sorted task list for the given user, generating it first
 * if it doesn't exist yet.
 */
export async function getOrGenerateTodayTasks(
  userId: string,
  userCapabilities: string[]
): Promise<LocalTask[]> {
  const today = getCurrentISTDate();
  await removeUnconfirmedInvalidTemplateFollowUps(userId);
  await selfHealCompletedFollowUps(userId);

  const existingToday = await db.tasks
    .where("[assigned_to+due_date]")
    .equals([userId, today])
    .toArray();

  const existingTemplateIds = new Set(
    existingToday
      .map((task) => task.template_id)
      .filter((templateId): templateId is string => Boolean(templateId)),
  );

  // Generate only missing, eligible non-follow-up templates.
  const allTemplates: LocalTaskTemplate[] = await db.task_templates.toArray();
  const matching = allTemplates.filter(
    (tpl) =>
      tpl.is_active === 1 &&
      userCapabilities.includes(tpl.applies_to_capability) &&
      !isFollowUpLikeTemplate(tpl) &&
      !existingTemplateIds.has(tpl.template_id),
  );

  for (const tpl of matching) {
    const task: LocalTask = {
      task_id: crypto.randomUUID(),
      assigned_to: userId,
      assigned_by: null,
      title: tpl.title,
      description: tpl.description,
      priority: tpl.default_priority,
      status: "Pending",
      source: "template",
      template_id: tpl.template_id,
      related_lead_id: null,
      due_date: today,
      started_at: null,
      completed_at: null,
      proof_note: null,
      proof_photo_url: null,
      created_at: new Date().toISOString(),
    };

    await transactionalMutation("tasks", "INSERT", task);

  }

  // Fetch all tasks due today (completed or not) OR overdue and still open
  const allRelevant = await db.tasks
    .where("assigned_to")
    .equals(userId)
    .and((t: LocalTask) => {
      if (t.due_date === today) return true; // everything for today
      if (t.due_date < today && t.status !== "Completed") return true; // incomplete past tasks
      return false;
    })
    .toArray();

  const visibleRelevant = allRelevant.filter(
    (task) => task.is_active !== false && !isProvenPipelineGeneratedTask(task) && !(task.source === "template" && isFollowUpLikeText(task.title, task.description)),
  );
  return sortTasks(deduplicateSelfScheduledFollowUps(visibleRelevant, userId));
}

export async function getMyDayStats(userId: string) {
  const today = getCurrentISTDate();

  const pendingToday = await db.tasks
    .where("assigned_to").equals(userId)
    .and((t: LocalTask) => t.is_active !== false && !isProvenPipelineGeneratedTask(t) && t.due_date <= today && t.status !== "Completed")
    .count();

  const scheduledLater = await db.tasks
    .where("assigned_to").equals(userId)
    .and((t: LocalTask) => t.is_active !== false && !isProvenPipelineGeneratedTask(t) && t.due_date > today && t.status === "Pending")
    .count();

  return { pendingToday, scheduledLater };
}

/** Sort by priority (High → Low) then creation order. */
export function sortTasks(tasks: LocalTask[]): LocalTask[] {
  return [...tasks].sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Mark a task's status and log it to task_status_history.
 * Call from "Mark done" / "Start" buttons in MyDayPage.
 */
export async function updateTaskStatus(
  task: LocalTask,
  newStatus: LocalTask["status"],
  changedBy: string,
  proof?: { note?: string; photoUrl?: string }
): Promise<void> {
  const oldStatus = task.status;
  const now = new Date().toISOString();

  const updates: Partial<LocalTask> = { status: newStatus };
  if (newStatus === "In Progress" && !task.started_at) updates.started_at = now;
  if (newStatus === "Completed") {
    updates.completed_at = now;
    if (proof?.note) updates.proof_note = proof.note;
    if (proof?.photoUrl) updates.proof_photo_url = proof.photoUrl;
  }

  await transactionalMutation("tasks", "UPDATE", { task_id: task.task_id, ...updates });

  const historyEntry = {
    id: crypto.randomUUID(),
    task_id: task.task_id,
    changed_by: changedBy,
    old_status: oldStatus,
    new_status: newStatus,
    changed_at: now,
  };
  await transactionalMutation("task_status_history", "INSERT", historyEntry);
}
