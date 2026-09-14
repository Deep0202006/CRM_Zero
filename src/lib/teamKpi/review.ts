import { z } from "zod";
import { visitUuid } from "@/lib/fieldVisits/range";
import { isValidISTDateKey } from "@/lib/dateTime";
import { deduplicateSelfScheduledFollowUps } from "@/lib/followUps";
import { isGenuineActiveTask } from "@/lib/workMetrics/genuineTask";
import type { LocalTask } from "@/lib/db";

const label = z.string().max(4000);
export const reviewTaskSchema = z.object({ task_id: visitUuid, assigned_to: visitUuid, assigned_by: visitUuid.nullable(), title: label,
  description: z.string().max(16000).nullable(), priority: z.enum(["High", "Medium", "Low"]), status: z.enum(["Pending", "In Progress", "Completed", "Missed"]),
  source: z.enum(["manual", "template"]), template_id: visitUuid.nullable(), related_lead_id: visitUuid.nullable(),
  due_date: z.string().refine(isValidISTDateKey), created_at: z.string(), is_active: z.boolean() });
export const reviewTargetSchema = z.object({ target_id: visitUuid, assigned_to_user_id: visitUuid, target_name: label, target_username: label, city: label, is_completed: z.boolean(), created_at: z.string() });
export type ReviewTask = z.infer<typeof reviewTaskSchema>;
export type ReviewTarget = z.infer<typeof reviewTargetSchema>;
export const REVIEW_BUCKETS = ["Overdue", "Today", "Later", "Missed"] as const;
export function reviewBucket(task: ReviewTask, today: string): typeof REVIEW_BUCKETS[number] {
  return task.status === "Missed" ? "Missed" : task.due_date < today ? "Overdue" : task.due_date === today ? "Today" : "Later";
}
const counts = z.object({ Overdue: z.number().int().nonnegative(), Today: z.number().int().nonnegative(), Later: z.number().int().nonnegative(), Missed: z.number().int().nonnegative() }).nullable();
export const managementReviewSchema = z.object({ kind: z.literal("current-workload-v1"), generated_at: z.string(), today: z.string().refine(isValidISTDateKey), employee: visitUuid.nullable(),
  cohort: z.array(z.object({ user_id: visitUuid, name: label, role: label })).max(200),
  tasks: z.object({ complete: z.boolean(), reason: z.string().nullable(), total: z.number().int().nonnegative().nullable(), records: z.array(reviewTaskSchema).max(50) }),
  targets: z.object({ complete: z.boolean(), reason: z.string().nullable(), total: z.number().int().nonnegative().nullable(), records: z.array(reviewTargetSchema).max(50) }),
  employees: z.array(z.object({ user_id: visitUuid, tasks: counts, targets: z.number().int().nonnegative().nullable() })).max(200),
}).refine(report => report.tasks.complete === (report.tasks.total !== null) && report.targets.complete === (report.targets.total !== null)
  && new Set(report.cohort.map(row => row.user_id)).size === report.cohort.length
  && new Set(report.employees.map(row => row.user_id)).size === report.employees.length
  && report.employees.length === (report.employee ? 1 : report.cohort.length)
  && (!report.employee || report.employees[0]?.user_id === report.employee)
  && report.employees.every(row => (row.tasks !== null) === report.tasks.complete && (row.targets !== null) === report.targets.complete)
  && (!report.tasks.complete || report.tasks.total === report.employees.reduce((sum, row) => sum + Object.values(row.tasks!).reduce((n, value) => n + value, 0), 0))
  && (!report.targets.complete || report.targets.total === report.employees.reduce((sum, row) => sum + row.targets!, 0))
  && (!report.tasks.complete || report.tasks.records.length <= report.tasks.total!)
  && (!report.targets.complete || report.targets.records.length <= report.targets.total!)
  && new Set(report.tasks.records.map(row => row.task_id)).size === report.tasks.records.length
  && new Set(report.targets.records.map(row => row.target_id)).size === report.targets.records.length
  && report.employees.every(row => report.cohort.some(member => member.user_id === row.user_id))
  && report.tasks.records.every(row => (!report.employee || row.assigned_to === report.employee) && report.cohort.some(member => member.user_id === row.assigned_to))
  && report.targets.records.every(row => (!report.employee || row.assigned_to_user_id === report.employee) && report.cohort.some(member => member.user_id === row.assigned_to_user_id)));
export type ManagementReviewReport = z.infer<typeof managementReviewSchema>;
export function buildManagementReview(input: { members: ManagementReviewReport["cohort"]; employee: string | null; today: string; generatedAt: string;
  tasks: ReviewTask[]; targets: ReviewTarget[]; taskError: string | null; targetError: string | null }): ManagementReviewReport {
  const members = input.members.filter(row => !input.employee || row.user_id === input.employee);
  const tasks = members.flatMap(member => {
    // Exact projected fields used by the existing pure deduplicator; no generated work or writes.
    const owned = input.tasks.filter(task => task.assigned_to === member.user_id && isGenuineActiveTask(task));
    return deduplicateSelfScheduledFollowUps(owned as LocalTask[], member.user_id).filter(task => task.status !== "Completed") as ReviewTask[];
  });
  const targets = input.targets.filter(target => !target.is_completed && members.some(member => member.user_id === target.assigned_to_user_id));
  const priority = { High: 0, Medium: 1, Low: 2 };
  tasks.sort((a, b) => a.due_date.localeCompare(b.due_date) || priority[a.priority] - priority[b.priority] || a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id));
  targets.sort((a, b) => a.target_name.localeCompare(b.target_name) || a.target_id.localeCompare(b.target_id));
  return managementReviewSchema.parse({ kind: "current-workload-v1", generated_at: input.generatedAt, today: input.today, employee: input.employee, cohort: input.members,
    tasks: { complete: !input.taskError, reason: input.taskError, total: input.taskError ? null : tasks.length, records: tasks.slice(0, 50) },
    targets: { complete: !input.targetError, reason: input.targetError, total: input.targetError ? null : targets.length, records: targets.slice(0, 50) },
    employees: members.map(member => ({ user_id: member.user_id, targets: input.targetError ? null : targets.filter(row => row.assigned_to_user_id === member.user_id).length,
      tasks: input.taskError ? null : Object.fromEntries(REVIEW_BUCKETS.map(bucket => [bucket, tasks.filter(row => row.assigned_to === member.user_id && reviewBucket(row, input.today) === bucket).length])) })),
  });
}
