import fs from "fs";
import path from "path";
import type { LocalTask } from "@/lib/db";
import {
  buildSelfScheduledFollowUpTask,
  isFollowUpLikeTemplate,
  isValidSelfScheduledFollowUp,
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
    };
    expect(buildSelfScheduledFollowUpTask({ ...input, dueDate: null })).toBeNull();
    const task = buildSelfScheduledFollowUpTask({ ...input, dueDate: "2026-08-01" });
    expect(task).toMatchObject({
      task_id: "stable-task-id",
      assigned_to: "employee-1",
      assigned_by: "employee-1",
      source: "manual",
    });
    expect(buildSelfScheduledFollowUpTask({ ...input, outcome: "Connected", dueDate: "2026-08-01" })).toBeNull();
  });

  it("uses one atomic local transaction and adds no task deletion or cleanup", () => {
    const callPage = fs.readFileSync(path.join(process.cwd(), "src/app/call-logs/page.tsx"), "utf8");
    const myDay = fs.readFileSync(path.join(process.cwd(), "src/app/my-day/page.tsx"), "utf8");
    const taskEngine = fs.readFileSync(path.join(process.cwd(), "src/lib/taskEngine.ts"), "utf8");
    expect(callPage).toContain('db.transaction("rw", [db.call_logs, db.tasks, db.sync_queue]');
    expect(callPage).toContain("call-followup-task:${logId}");
    expect(callPage).toContain("needsCallFollowUp(outcome) && !nextFollowup");
    expect(callPage).toContain('db.call_logs.where("user_id").equals(currentUser.user_id)');
    expect(myDay).toContain("const isSelfScheduledFollowUp = isValidSelfScheduledFollowUp(task, currentUser.user_id)");
    expect(myDay).toContain("[db.call_logs, db.tasks, db.task_status_history, db.sync_queue]");
    expect(myDay).not.toContain("db.allocated_targets.bulkDelete");
    expect(callPage).not.toContain('transactionalMutation("tasks", "DELETE"');
    expect(taskEngine).not.toContain('transactionalMutation("tasks", "DELETE"');
  });

  it("removes fabricated weekly digest companies", () => {
    const myDay = fs.readFileSync(path.join(process.cwd(), "src/app/my-day/page.tsx"), "utf8");
    expect(myDay).not.toContain("Acme Corp");
    expect(myDay).not.toContain("Global Tech");
    expect(myDay).toContain("Weekly intelligence unavailable");
  });
});
