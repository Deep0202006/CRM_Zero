import { getCurrentISTDate } from "@/lib/dateTime";
import { queueTaskInsertOnce, type LocalTask } from "@/lib/db";
import { pipelineTaskIdFor } from "@/lib/pipeline/salesReview";

export { pipelineTaskIdFor } from "@/lib/pipeline/salesReview";

export async function createExplicitPipelineTask(input: { userId: string; leadId: string; businessName: string }) {
  const dueDate = getCurrentISTDate();
  const taskId = await pipelineTaskIdFor(input.userId, input.leadId, dueDate);
  const task: LocalTask = {
    task_id: taskId,
    assigned_to: input.userId,
    assigned_by: input.userId,
    title: `Follow up: ${input.businessName}`,
    description: `Explicit Pipeline follow-up for ${input.businessName}.`,
    priority: "Medium",
    status: "Pending",
    source: "manual",
    template_id: null,
    related_lead_id: input.leadId,
    due_date: dueDate,
    started_at: null,
    completed_at: null,
    proof_note: null,
    proof_photo_url: null,
    created_at: new Date().toISOString(),
    is_active: true,
  };
  return { task, result: await queueTaskInsertOnce(task, `pipeline-task:${taskId}`) };
}
