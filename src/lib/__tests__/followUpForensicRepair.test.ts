import fs from "node:fs";
import path from "node:path";

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("follow-up forensic recurrence guards", () => {
  const myDay = source("src/app/my-day/page.tsx");
  const taskEngine = source("src/lib/taskEngine.ts");
  const database = source("src/lib/db.ts");
  const callLogs = source("src/app/call-logs/page.tsx");
  const kpi = source("src/app/manager/kpi/page.tsx");
  const logout = source("src/context/AuthContext.tsx");

  test("self-heals only the authenticated user's conclusively completed open follow-ups", () => {
    expect(taskEngine).toContain('.where("assigned_to")');
    expect(taskEngine).toContain(".equals(userId)");
    expect(taskEngine).toContain('row.new_status === "Completed" && row.changed_by === userId');
    expect(taskEngine).toContain("parseFollowUpSourceCallId(task.description)");
    expect(taskEngine).toContain("completionCall?.user_id === userId");
    expect(taskEngine).toContain("followup-self-heal:${task.task_id}");
    expect(taskEngine).not.toContain('table_name: "call_logs"');
  });

  test("queues task confirmation before history and completion call", () => {
    const taskQueue = myDay.indexOf('idempotency_key: `followup-completion-task:');
    const historyQueue = myDay.indexOf('idempotency_key: `followup-completion-history:');
    const callQueue = myDay.indexOf('idempotency_key: `followup-completion-call:');
    expect(taskQueue).toBeGreaterThan(0);
    expect(taskQueue).toBeLessThan(historyQueue);
    expect(historyQueue).toBeLessThan(callQueue);
    expect(database).toContain('item.idempotency_key.startsWith("followup-completion-history:")');
    expect(database).toContain('item.idempotency_key.startsWith("followup-completion-call:")');
    expect(database).toContain("if (prerequisitePending) continue");
  });

  test("one scheduling call has one stable task and source-call idempotency", () => {
    expect(callLogs).toContain("const logId = crypto.randomUUID()");
    expect(callLogs).toContain("const taskId = nextFollowupDate ? crypto.randomUUID() : null");
    expect(callLogs).toContain("sourceCallId: logId");
    expect(callLogs).toContain("call-followup-task:${logId}");
    expect(callLogs.match(/if \(followupTask\)/g)).toHaveLength(1);
  });

  test("uses India date for task generation and My Day comparisons", () => {
    expect(taskEngine).toContain("const today = getCurrentISTDate()");
    expect(myDay).toContain("const todayStr = getCurrentISTDate()");
    expect(taskEngine).not.toContain('new Date().toISOString().slice(0, 10)');
  });

  test("invalid template follow-ups are hidden and only an exact pending local insert can be removed", () => {
    expect(taskEngine).toContain('task.source === "template"');
    expect(taskEngine).toContain("isFollowUpLikeText(task.title, task.description)");
    expect(taskEngine).toContain('item.table_name === "tasks"');
    expect(taskEngine).toContain('item.action === "INSERT"');
    expect(taskEngine).toContain("(item.data as Partial<LocalTask>).task_id === task.task_id");
    expect(taskEngine).toContain("if (history || completionCall) continue");
    expect(taskEngine).toContain("if (!template || !isFollowUpLikeTemplate(template)) continue");
    expect(taskEngine).toContain("if (remoteCheckError || remoteTask) continue");
    expect(taskEngine).toContain('.eq("assigned_to", userId)');
    expect(taskEngine).toContain("await db.sync_queue.delete(insert.id!)");
    expect(taskEngine).toContain("await db.tasks.delete(task.task_id)");
  });

  test("does not broaden destructive operations or regress KPI and logout contracts", () => {
    for (const file of [myDay, taskEngine, callLogs]) {
      expect(file).not.toMatch(/db\.(call_logs|client_queries|mapping_requests|field_visits|attendance)\.delete/);
      expect(file).not.toMatch(/\.(clear|deleteDatabase)\s*\(/);
    }
    expect(kpi).toContain("getCurrentISTDate");
    expect(logout).toContain('fetch("/api/attendance/clock-out"');
    expect(logout).not.toMatch(/pagehide|beforeunload|sendBeacon/);
  });
});
