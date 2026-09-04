import { resolve } from "node:path";
import { mintOwnerPermit } from "../release-controller.mjs";
import { createTaskInCurrentWorkspace } from "../task-controller.mjs";
import { amendTask, readAutomaticTaskContext, taskContextPointer } from "../task-state.mjs";
import { serializeSessionContext } from "../experience.mjs";
import { createAndBindSessionTask, loadState, readHookInput, requireContextReread, resolveBoundTask, sha256, updateState } from "./state-store.mjs";

export const classifyUserPrompt = (prompt) => {
  const text = String(prompt ?? "").trim();
  if (/^OWNER_RELEASE_APPROVED\|/.test(text)) return { disposition: "OWNER_RELEASE", text };
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
  const classified = classifyUserPrompt(prompt); let binding = null;
  try { binding = resolveBoundTask(sessionId, { allowTerminal: classified.disposition === "NEW_TASK" }); } catch (error) { if (error.message !== "SESSION_TASK_UNBOUND") throw error; }
  if (classified.taskId && classified.taskId !== binding?.task.taskId) throw new Error(`CONTINUATION_TASK_MISMATCH:${classified.taskId}:${binding?.task.taskId ?? "UNBOUND"}`);
  if (classified.disposition === "OWNER_RELEASE") {
    if (!binding?.task) throw new Error("SESSION_TASK_UNBOUND"); const permit = mintOwnerPermit({ line: classified.text, sessionId, taskId: binding.task.taskId }); recordPrompt(sessionId, classified);
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, binding.task, { promptDisposition: classified.disposition, ownerReleasePermit: permit }) } };
  }
  if (classified.disposition === "NEW_TASK") {
    const created = createAndBindSessionTask(sessionId, () => createTaskInCurrentWorkspace(classified.requirement)); recordPrompt(sessionId, classified);
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, created.task, { promptDisposition: classified.disposition, createdTaskId: created.task.taskId }) } };
  }
  if (!binding?.task) { recordPrompt(sessionId, classified); return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, null, { promptDisposition: classified.disposition, taskBootstrapRequired: true }) } }; }
  const amendment = classified.disposition === "AMENDMENT" ? amendTask(binding.task.taskId, binding.task.revision, classified.text) : null; recordPrompt(sessionId, classified); const task = amendment?.task ?? binding.task;
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: automaticContext(sessionId, task, { promptDisposition: classified.disposition, amendment: amendment ? { sequence: amendment.amendment.amendmentSequence, requirementHash: amendment.amendment.requirementHash } : null }) } };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { const input = await readHookInput(); console.log(JSON.stringify(submitUserPrompt({ sessionId: input.session_id ?? "unknown", prompt: input.prompt ?? input.user_prompt ?? "" }))); }
  catch (error) { console.log(JSON.stringify({ continue: false, stopReason: `TASK_PROMPT_FAILED:${error.message}` })); }
}
