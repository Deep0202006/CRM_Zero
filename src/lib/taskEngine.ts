// src/lib/taskEngine.ts
// Task generation engine — runs right after login / clock-in.
// Checks whether today's tasks already exist for the user; if not, generates
// them from task_templates matching the user's active capabilities, writes to
// Dexie and queues for sync using the same sync_queue pattern as leads/attendance.

import { db, transactionalMutation, type LocalTask, type LocalTaskTemplate, type SyncQueueItem } from "./db";

export type { LocalTask, LocalTaskTemplate };

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/**
 * Call once right after login (or right after clock-in on /attendance).
 * Returns today's sorted task list for the given user, generating it first
 * if it doesn't exist yet.
 */
export async function getOrGenerateTodayTasks(
  userId: string,
  userCapabilities: string[]
): Promise<LocalTask[]> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const existingToday = await db.tasks
    .where("[assigned_to+due_date]")
    .equals([userId, today])
    .toArray();

  const generated: LocalTask[] = [];

  if (existingToday.length === 0) {

    // No tasks yet today — generate from matching templates
    const allTemplates: LocalTaskTemplate[] = await db.task_templates.toArray();
    const matching = allTemplates.filter(
      (tpl) => tpl.is_active === 1 && userCapabilities.includes(tpl.applies_to_capability)
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

    generated.push(task);
    }
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

  return sortTasks(allRelevant);
}

export async function getMyDayStats(userId: string) {
  const today = new Date().toISOString().slice(0, 10);

  const pendingToday = await db.tasks
    .where("assigned_to").equals(userId)
    .and((t: LocalTask) => t.due_date <= today && t.status !== "Completed")
    .count();

  const scheduledLater = await db.tasks
    .where("assigned_to").equals(userId)
    .and((t: LocalTask) => t.due_date > today && t.status === "Pending")
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
