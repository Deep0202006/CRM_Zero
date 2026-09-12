import type { SupabaseClient } from "@supabase/supabase-js";
import { ReportUnavailable, type ReportResource } from "@/lib/analytics/reportResource";
import { buildManagementReview, reviewTaskSchema, reviewTargetSchema, type ReviewTask, type ReviewTarget } from "./review";
import { loadHistoryCohort } from "./historyServer";
import { HistoryRequestError } from "./history";

export async function loadManagementReview(client: SupabaseClient, resource: ReportResource, employee: string | null, today: string, generatedAt: string) {
  const members = await loadHistoryCohort(client, { from: today, to: today, employee, days: 1, previous_from: today, previous_to: today }, resource);
  if (employee && !members.some(member => member.user_id === employee)) throw new HistoryRequestError("REVIEW_EMPLOYEE_SCOPE", "Employee outside the current cohort.", 404);
  const ids = members.filter(member => !employee || member.user_id === employee).map(member => member.user_id);
  const tasks: ReviewTask[] = [], targets: ReviewTarget[] = [];
  const read = async (target: boolean) => {
    let cursor = "", bytes = 0;
    try {
      for (let page = 0; page < 10; page++) {
        const key = target ? "target_id" : "task_id";
        let query = target
          ? client.from("allocated_targets").select("target_id,assigned_to_user_id,target_name,target_username,city,is_completed,created_at").in("assigned_to_user_id", ids).eq("is_completed", false)
          : client.from("tasks").select("task_id,assigned_to,assigned_by,title,description,priority,status,source,template_id,related_lead_id,due_date,created_at,is_active").in("assigned_to", ids).eq("is_active", true);
        if (cursor) query = query.gt(key, cursor);
        const result = await resource.read(query.order(key).limit(500));
        if (result.error || !Array.isArray(result.data) || result.data.length > 500) throw new ReportUnavailable("Current source unavailable");
        bytes += new TextEncoder().encode(JSON.stringify(result.data)).byteLength;
        if (bytes > 2 * 1024 * 1024) throw new ReportUnavailable("Current source byte limit");
        if (!result.data.length) return null;
        for (const raw of result.data) {
          if (target) {
            const row = reviewTargetSchema.parse(raw);
            if (!ids.includes(row.assigned_to_user_id) || row.is_completed || row.target_id <= cursor) throw new ReportUnavailable("Target scope/order mismatch");
            targets.push(row); cursor = row.target_id;
          } else {
            const row = reviewTaskSchema.parse(raw);
            if (!ids.includes(row.assigned_to) || !row.is_active || row.task_id <= cursor) throw new ReportUnavailable("Task scope/order mismatch");
            tasks.push(row); cursor = row.task_id;
          }
        }
      }
      return "Source not exhausted within 10 pages. Select an employee or retry; totals unavailable.";
    } catch {
      resource.check();
      return "Source unavailable or incomplete. Retained bounded records are not complete workload totals.";
    }
  };
  // At most3 cohort reads +10 task pages +10 target pages, within one24-read resource.
  const [taskError, targetError] = await Promise.all([read(false), read(true)]);
  resource.check();
  return buildManagementReview({ members, employee, today, generatedAt, tasks, targets, taskError, targetError });
}
