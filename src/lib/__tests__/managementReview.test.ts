import { buildManagementReview, managementReviewSchema, reviewBucket, type ReviewTask, type ReviewTarget } from "@/lib/teamKpi/review";
const id = (n: number) => `10000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const members = [1, 2].map(n => ({ user_id: id(n), name: `Employee ${n}`, role: "Field" }));
const task = (n: number, patch: Partial<ReviewTask> = {}): ReviewTask => ({ task_id: id(n), assigned_to: id(1), assigned_by: id(2), title: `Task ${n}`, description: null,
  priority: "High", status: "Pending", source: "manual", template_id: null, related_lead_id: null, due_date: "2026-09-09", created_at: "2026-09-08T01:00:00Z", is_active: true, ...patch });
const target: ReviewTarget = { target_id: id(30), assigned_to_user_id: id(1), target_name: "Exact target", target_username: "target30", city: "Pune", is_completed: false, created_at: "2026-09-08T01:00:00Z" };
const build = (tasks: ReviewTask[], taskError: string | null = null, targetError: string | null = null, employee: string | null = null) => buildManagementReview({ members, tasks, targets: [target], today: "2026-09-09", generatedAt: "2026-09-09T01:00:00Z", employee, taskError, targetError });

it("keeps current assignee buckets, Missed and targets distinct; excludes inactive/generated/Completed records", () => {
  const rows = [task(10, { due_date: "2026-09-08" }), task(11), task(12, { due_date: "2026-09-10" }), task(13, { status: "Missed" }),
    task(14, { status: "Completed" }), task(15, { is_active: false }), task(16, { assigned_by: null, related_lead_id: id(40), title: "Follow up: Example (Contacted)", description: "Lead moved to Contacted. Follow up before it goes stale." }),
    task(17, { source: "template", title: "Follow-up template" }), task(18, { assigned_to: id(2) }), task(19, { assigned_to: id(99) })];
  const report = build(rows);
  expect(report.tasks.total).toBe(5); expect(report.targets.total).toBe(1);
  expect(report.employees[0]).toEqual({ user_id: id(1), tasks: { Overdue: 1, Today: 1, Later: 1, Missed: 1 }, targets: 1 });
  expect(report.employees[1].tasks?.Today).toBe(1);
  expect(reviewBucket(rows[3], "2026-09-09")).toBe("Missed");
  expect(report.targets.records[0]).not.toHaveProperty("due_date");
});

it("deduplicates genuine scheduled follow-ups per assignee, never across employees", () => {
  const description = `Scheduled follow-up for: Exact client\n[ZD_FOLLOWUP_SOURCE_CALL:${id(90)}]`;
  const report = build([task(10, { assigned_by: id(1), description }), task(11, { assigned_by: id(1), description }), task(12, { assigned_to: id(2), assigned_by: id(2), description })]);
  expect(report.tasks.total).toBe(2); expect(report.employees.map(row => row.tasks?.Today)).toEqual([1, 1]);
  expect(build([task(10, { assigned_by: id(1), description }), task(11, { assigned_by: id(1), description, status: "Completed" })]).tasks.total).toBe(0);
});

it("rejects contradictory totals, duplicate employees and complete-looking partial summaries", () => {
  const report = build([task(10)]);
  expect(managementReviewSchema.safeParse({ ...report, tasks: { ...report.tasks, total: 2 } }).success).toBe(false);
  expect(managementReviewSchema.safeParse({ ...report, employees: [report.employees[0], report.employees[0]] }).success).toBe(false);
  expect(managementReviewSchema.safeParse({ ...report, tasks: { ...report.tasks, complete: false, total: null } }).success).toBe(false);
});

it("preserves bounded partial records without presenting complete totals or blocking the other source", () => {
  const report = build(Array.from({ length: 60 }, (_, n) => task(n + 100)), "Source capped");
  expect(report.tasks.records).toHaveLength(50); expect(report.tasks.total).toBeNull(); expect(report.employees.every(row => row.tasks === null)).toBe(true);
  expect(report.targets.complete).toBe(true); expect(report.targets.total).toBe(1);
  expect(build([task(10)], null, "Targets unavailable").tasks.total).toBe(1);
});

it("narrowing preserves reference identities but shows only the selected current assignee", () => {
  const report = build([task(10), task(11, { assigned_to: id(2) })], null, null, id(2));
  expect(report.cohort).toEqual(members); expect(report.tasks.records.map(row => row.task_id)).toEqual([id(11)]); expect(report.targets.total).toBe(0);
});
