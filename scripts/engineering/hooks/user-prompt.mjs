import { resolve } from "node:path";
import { mintOwnerPermit } from "../release-controller.mjs";
import { createRecoveryTaskInCurrentWorkspace, createTaskInCurrentWorkspace } from "../task-controller.mjs";
import { amendTask, readAutomaticTaskContext, taskContextPointer } from "../task-state.mjs";
import { serializeSessionContext } from "../experience.mjs";
import { createAndBindSessionTask, loadState, readHookInput, requireContextReread, resolveOrBindSessionTask, sha256, updateState } from "./state-store.mjs";

export const classifyUserPrompt = (prompt) => {
  const text = String(prompt ?? "").trim();
  if (/^OWNER_RELEASE_APPROVED\|/.test(text)) return { disposition: "OWNER_RELEASE", text };
  if (/^RESUME_CURRENT_WORKSPACE$/i.test(text)) return { disposition: "RESUME_CURRENT_WORKSPACE", text };
  const kernelContinue = /^KERNEL_CONTINUE\|taskId=([a-z0-9-]+)\b/i.exec(text); if (kernelContinue) return { disposition: "CONTINUATION", text, taskId: kernelContinue[1] };
  const nextTask = /^NEW_TASK:\s*(.{8,})$/is.exec(text); if (nextTask) return { disposition: "NEW_TASK", text, requirement: nextTask[1].trim() };
  if (/^(?:status|progress|what(?:'s| is) the (?:current )?(?:status|progress)|where do we stand)\??$/i.test(text)) return { disposition: "STATUS", text };
  if (/^(?:continue|resume|go ahead|keep going|proceed)(?: please)?[.!]?$/i.test(text)) return { disposition: "CONTINUATION", text };
  return { disposition: "AMENDMENT", text };
};
const recordPrompt = (sessionId, classified) => updateState(sessionId, (current) => ({ ...current, promptSequence: current.promptSequence + 1, lastPrompt: { sequence: current.promptSequence + 1, disposition: classified.disposition, sha256: sha256(classified.text), byteCount: Buffer.byteLength(classified.text) } }));
const automaticContext = (sessionId, task, fields) => {
  if (!task) return serializeSessionContext({ kernel: "V6A", sessionStatus: loadState(sessionId).status, boundTaskId: null, ...fields, completionClaim: false });
  const pointer = taskContextPointer(task.taskId), additionalContext = serializeSessionContext({ kernel: "V6A", sessionStatus: loadState(sessionId).status, boundTaskId: task.taskId, task: readAutomaticTaskContext(task.taskId), ...fields, completionClaim: false }, undefined, pointer);
  if (JSON.parse(additionalContext).contextPointer) requireContextReread(sessionId, pointer);
  return additionalContext;
};

export const submitUserPrompt = ({ sessionId, prompt }) => {
  const classified = classifyUserPrompt(prompt), binding = resolveOrBindSessionTask(sessionId, { exactTaskId: classified.taskId });
  if (classified.disposition === "OWNER_RELEASE") {
    if (!binding?.task) throw new Error("SESSION_TASK_UNBOUND"); const permit = mintOwnerPermit({ line: classified.text, sessionId, taskId: binding.task.taskId }); recordPrompt(sessionId, classified);
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, binding.task, { promptDisposition: classified.disposition, ownerReleasePermit: permit }) } };
  }
  if (classified.disposition === "NEW_TASK") {
    if (binding.task) throw new Error(`NEW_TASK_ACTIVE_TASK_EXISTS:${binding.task.taskId}`);
    if (binding.resolution === "RECOVERY_REQUIRED") throw new Error("RECOVERY_REQUIRED:RESUME_CURRENT_WORKSPACE");
    const created = createAndBindSessionTask(sessionId, () => createTaskInCurrentWorkspace(classified.requirement)); recordPrompt(sessionId, classified);
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, created.task, { promptDisposition: classified.disposition, createdTaskId: created.task.taskId }) } };
  }
  if (classified.disposition === "RESUME_CURRENT_WORKSPACE") {
    const recovered = binding.task ? binding : createAndBindSessionTask(sessionId, createRecoveryTaskInCurrentWorkspace, { reuseExisting: true }); recordPrompt(sessionId, classified);
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, recovered.task, { promptDisposition: classified.disposition, recoveredWorkspace: recovered.recoveredWorkspace ?? null }) } };
  }
  if (!binding?.task) { recordPrompt(sessionId, classified); return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, null, { promptDisposition: classified.disposition, ...(binding.recovery ? { recovery: { required: true, action: binding.recovery.intent, reason: binding.recovery.reason } } : { taskBootstrapRequired: true }) }) } }; }
  const amendment = classified.disposition === "AMENDMENT" ? amendTask(binding.task.taskId, binding.task.revision, classified.text) : null; recordPrompt(sessionId, classified); const task = amendment?.task ?? binding.task;
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, task, { promptDisposition: classified.disposition, amendment: amendment ? { sequence: amendment.amendment.amendmentSequence, requirementHash: amendment.amendment.requirementHash } : null }) } };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { const input = await readHookInput(); console.log(JSON.stringify(submitUserPrompt({ sessionId: input.session_id ?? "unknown", prompt: input.prompt ?? input.user_prompt ?? "" }))); }
  catch (error) { console.log(JSON.stringify({ continue: false, stopReason: `TASK_PROMPT_FAILED:${error.message}` })); }
}
