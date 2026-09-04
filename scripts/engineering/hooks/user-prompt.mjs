import { resolve } from "node:path";
import { mintOwnerPermit } from "../release-controller.mjs";
import { amendTask, readTaskSnapshot } from "../task-state.mjs";
import { serializeSessionContext } from "../experience.mjs";
import { readHookInput, resolveBoundTask } from "./state-store.mjs";

export const submitUserPrompt = ({ sessionId, prompt }) => {
  const binding = resolveBoundTask(sessionId), continuation = /^KERNEL_CONTINUE\|taskId=([a-z0-9-]+)\b/i.exec(prompt);
  if (continuation && continuation[1] !== binding.task.taskId) throw new Error(`CONTINUATION_TASK_MISMATCH:${continuation[1]}:${binding.task.taskId}`);
  if (/^OWNER_RELEASE_APPROVED\|/.test(prompt)) {
    const permit = mintOwnerPermit({ line: prompt, sessionId, taskId: binding.task.taskId });
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: serializeSessionContext({ boundTaskId: binding.task.taskId, ownerReleasePermit: permit, completionClaim: false }) } };
  }
  const amendment = continuation ? null : amendTask(binding.task.taskId, binding.task.revision, prompt);
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: serializeSessionContext({ boundTaskId: binding.task.taskId, amendment: amendment ? { sequence: amendment.amendment.sequence, requirementHash: amendment.amendment.requirementHash } : null, task: readTaskSnapshot(binding.task.taskId) }) } };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { const input = await readHookInput(); console.log(JSON.stringify(submitUserPrompt({ sessionId: input.session_id ?? "unknown", prompt: input.prompt ?? input.user_prompt ?? "" }))); }
  catch (error) { console.log(JSON.stringify({ continue: false, stopReason: `TASK_AMENDMENT_FAILED:${error.message}` })); }
}
