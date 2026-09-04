import { resolve } from "node:path";
import { doctor } from "../kernel-doctor.mjs";
import { readAutomaticTaskContext, taskContextPointer } from "../task-state.mjs";
import { bindSession, readHookInput, requireContextReread, updateState } from "./state-store.mjs";
import { serializeSessionContext } from "../experience.mjs";

export const startSession = ({ sessionId, source = "startup" }) => {
  const health = doctor(), binding = bindSession(sessionId);
  if (health.failures.length) updateState(sessionId, (current) => ({ ...current, status: "SAFETY_CONFLICT" }));
  const sessionStatus = health.failures.length ? "SAFETY_CONFLICT" : binding.state.status;
  if (!binding.task) return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: serializeSessionContext({ kernel: "V6A", source, sessionStatus, boundTaskId: null, taskBootstrap: { required: true, command: "npm run crm:task -- --task <requirement>" }, completionClaim: false }) } };
  const pointer = taskContextPointer(binding.task.taskId), additionalContext = serializeSessionContext({ kernel: "V6A", source, sessionStatus, boundTaskId: binding.task.taskId, task: readAutomaticTaskContext(binding.task.taskId), completionClaim: false }, undefined, pointer);
  if (JSON.parse(additionalContext).contextPointer) requireContextReread(sessionId, pointer);
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { const input = await readHookInput(); console.log(JSON.stringify(startSession({ sessionId: input.session_id ?? "unknown", source: input.source ?? "startup" }))); }
  catch (error) { console.log(JSON.stringify({ continue: false, stopReason: `SESSION_BINDING_FAILED:${error.message}` })); }
}
