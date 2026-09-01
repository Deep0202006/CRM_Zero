import fs from "fs";
import path from "path";
import type { LocalTask } from "@/lib/db";
import {
  buildSelfScheduledFollowUpTask,
  createFollowUpSourceCallMarker,
  deduplicateSelfScheduledFollowUps,
  parseFollowUpSourceCallId,
  stripInternalFollowUpMarkers,
  isFollowUpLikeTemplate,
  isValidSelfScheduledFollowUp,
  reconcileCallFollowUpTasks,
} from "@/lib/followUps";

const baseTask: LocalTask = {
  task_id: "task-1",
  assigned_to: "employee-1",
  assigned_by: "employee-1",
  title: "Follow-up Call",
  description: "Scheduled follow-up for: Client",
  priority: "High",
  status: "Pending",
  source: "manual",
  template_id: null,
  related_lead_id: "lead-1",
  due_date: "2026-08-01",
  started_at: null,
  completed_at: null,
  proof_note: null,
  proof_photo_url: null,
  created_at: "2026-07-31T00:00:00.000Z",
};

describe("self-scheduled follow-up contract", () => {
  it("includes only a manual follow-up assigned by and to the authenticated employee", () => {
    expect(isValidSelfScheduledFollowUp(baseTask, "employee-1")).toBe(true);
    expect(isValidSelfScheduledFollowUp({ ...baseTask, source: "template", template_id: "template-1" }, "employee-1")).toBe(false);
    expect(isValidSelfScheduledFollowUp({ ...baseTask, assigned_by: "manager-1" }, "employee-1")).toBe(false);
    expect(isValidSelfScheduledFollowUp({ ...baseTask, assigned_to: "employee-2" }, "employee-1")).toBe(false);
  });

  it("blocks follow-up-like templates while leaving normal templates eligible", () => {
    expect(isFollowUpLikeTemplate({ title: "Call again", description: null })).toBe(true);
    expect(isFollowUpLikeTemplate({ title: "Daily pipeline review", description: "Review assigned leads" })).toBe(false);
  });

  it("requires a date and creates exactly one stable task for one submitted call", () => {
    const input = {
      outcome: "No response (followup)",
      authenticatedUserId: "employee-1",
      taskId: "stable-task-id",
      clientDisplay: "Client",
      related_lead_id: "lead-1",
      notes: "",
      createdAt: "2026-07-31T00:00:00.000Z",
      sourceCallId: "11111111-1111-4111-8111-111111111111",
    };
    expect(buildSelfScheduledFollowUpTask({ ...input, dueDate: null })).toBeNull();
    const task = buildSelfScheduledFollowUpTask({ ...input, dueDate: "2026-08-01" });
    expect(task).toMatchObject({
      task_id: "stable-task-id",
      assigned_to: "employee-1",
      assigned_by: "employee-1",
      source: "manual",
    });
    expect(parseFollowUpSourceCallId(task?.description ?? null)).toBe(input.sourceCallId);
    expect(stripInternalFollowUpMarkers(task?.description ?? null)).not.toContain("ZD_FOLLOWUP_SOURCE_CALL");
    expect(buildSelfScheduledFollowUpTask({ ...input, outcome: "Connected", dueDate: "2026-08-01" })).toBeNull();
  });

  it("uses one atomic local transaction and limits cleanup to invalid pending template inserts", () => {
    const callPage = fs.readFileSync(path.join(process.cwd(), "src/app/call-logs/page.tsx"), "utf8");
    const myDay = fs.readFileSync(path.join(process.cwd(), "src/app/my-day/page.tsx"), "utf8");
    const taskEngine = fs.readFileSync(path.join(process.cwd(), "src/lib/taskEngine.ts"), "utf8");
    expect(callPage).toContain('db.transaction("rw", [db.call_logs, db.tasks, db.sync_queue]');
    expect(callPage).toContain("call-followup-task:${logId}");
    expect(callPage).toContain("needsCallFollowUp(outcome) && !nextFollowup");
    expect(callPage).toContain("fetchCallLogSnapshot(currentUser.user_id, isAdmin)");
    expect(myDay).toContain("const isSelfScheduledFollowUp = isValidSelfScheduledFollowUp(task, currentUser.user_id)");
    expect(myDay).toContain("[db.call_logs, db.tasks, db.task_status_history, db.sync_queue]");
    expect(myDay).not.toContain("db.allocated_targets.bulkDelete");
    expect(callPage).not.toContain('transactionalMutation("tasks", "DELETE"');
    expect(taskEngine).toContain('item.action === "INSERT"');
    expect(taskEngine).toContain('task.source === "template"');
    expect(taskEngine).not.toContain('transactionalMutation("tasks", "DELETE"');
  });

  it("deduplicates the same source call but preserves separate calls for the same client", () => {
    const first = {
      ...baseTask,
      task_id: "task-a",
      description: `${baseTask.description}\n${createFollowUpSourceCallMarker("11111111-1111-4111-8111-111111111111")}`,
    };
    const stale = { ...first, task_id: "task-b", created_at: "2026-07-31T00:00:30.000Z" };
    const completed = { ...stale, task_id: "task-c", status: "Completed" as const };
    const separate = {
      ...first,
      task_id: "task-d",
      description: `${baseTask.description}\n${createFollowUpSourceCallMarker("22222222-2222-4222-8222-222222222222")}`,
    };
    const result = deduplicateSelfScheduledFollowUps([first, stale, completed, separate], "employee-1");
    expect(result.map((task) => task.task_id)).toEqual(["task-c", "task-d"]);
  });

  it("reconciles one active source-linked intent without rewriting completed history", () => {
    const sourceCallId = "11111111-1111-4111-8111-111111111111";
    const description = `${baseTask.description}\n${createFollowUpSourceCallMarker(sourceCallId)}`;
    const pending = { ...baseTask, task_id: "pending", description };
    const duplicate = { ...pending, task_id: "duplicate", created_at: "2026-07-31T00:01:00.000Z" };
    const completed = { ...pending, task_id: "completed", status: "Completed" as const, completed_at: "2026-08-01T00:00:00.000Z" };
    const updated = reconcileCallFollowUpTasks({ existingTasks: [pending, duplicate, completed], outcome: "Requested more info", dueDate: "2026-08-03", authenticatedUserId: "employee-1", newTaskId: "new", clientDisplay: "Changed Client", relatedLeadId: "lead-2", notes: "changed", changedAt: "2026-08-02T00:00:00.000Z", sourceCallId });
    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({ task_id: "pending", due_date: "2026-08-03", related_lead_id: "lead-2", is_active: true });
    expect(updated[1]).toMatchObject({ task_id: "duplicate", is_active: false });
    expect(updated.some((task) => task.task_id === "completed")).toBe(false);

    const cancelled = reconcileCallFollowUpTasks({ existingTasks: [updated[0], completed], outcome: "Happy call", dueDate: null, authenticatedUserId: "employee-1", newTaskId: "unused", clientDisplay: "Changed Client", relatedLeadId: "lead-2", notes: "", changedAt: "2026-08-02T01:00:00.000Z", sourceCallId });
    expect(cancelled).toEqual([expect.objectContaining({ task_id: "pending", is_active: false, status: "Pending" })]);
  });

  it("removes fabricated weekly digest companies", () => {
    const myDay = fs.readFileSync(path.join(process.cwd(), "src/app/my-day/page.tsx"), "utf8");
    expect(myDay).not.toContain("Acme Corp");
    expect(myDay).not.toContain("Global Tech");
    expect(myDay).toContain("Weekly intelligence unavailable");
  });
});
