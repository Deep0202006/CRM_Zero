import type { LocalTask } from "../db";
import { isFollowUpLikeText } from "../followUps";

export function isProvenPipelineGeneratedTask(task: Pick<LocalTask, "assigned_by" | "source" | "related_lead_id" | "title" | "description">): boolean {
  if (task.assigned_by || task.source !== "manual" || !task.related_lead_id) return false;
  const title = task.title ?? "", description = task.description ?? "";
  const stage = "(?:Contacted|Interested|Not Interested|Registration|Installation|Payment|Converted|Renewal Due)";
  if (new RegExp(`^Lead moved to ${stage}\\. Follow up before it goes stale\\.$`).test(description) && new RegExp(`^Follow up: .+ \\(${stage}\\)$`).test(title)) return true;
  return description === "Required for registration." && /^(?:Collect GST certificate|Collect PAN card|Collect Drug Licence|Collect Bill Photo):/.test(title);
}

export function isGenuineActiveTask(task: Pick<LocalTask, "assigned_by" | "source" | "related_lead_id" | "title" | "description" | "is_active">) {
  return task.is_active !== false && !isProvenPipelineGeneratedTask(task)
    && !(task.source === "template" && isFollowUpLikeText(task.title, task.description));
}
