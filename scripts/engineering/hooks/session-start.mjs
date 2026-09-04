import { resolve } from "node:path";
import { doctor } from "../kernel-doctor.mjs";
import { readTaskSnapshot, taskDirectory } from "../task-state.mjs";
import { readFileSync } from "node:fs";
import { bindSession, readHookInput, updateState } from "./state-store.mjs";
import { serializeSessionContext } from "../experience.mjs";

export const startSession = ({ sessionId, source = "startup" }) => {
  const health = doctor(), binding = bindSession(sessionId), directory = taskDirectory(binding.task.taskId), context = JSON.parse(readFileSync(resolve(directory, "context.json"), "utf8"));
  if (health.failures.length) updateState(sessionId, (current) => ({ ...current, status: "SAFETY_CONFLICT" }));
  const additionalContext = serializeSessionContext({
    kernel: "V6A", source, sessionStatus: health.failures.length ? "SAFETY_CONFLICT" : binding.state.status,
    safetyConflict: health.failures[0] ?? null, boundTaskId: binding.task.taskId,
    task: readTaskSnapshot(binding.task.taskId),
    experience: (context.experiencePacket ?? []).slice(0, 3).map((item) => ({ id: item.id, action: item.requiredPreventionAction ?? item.rule })),
  });
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { const input = await readHookInput(); console.log(JSON.stringify(startSession({ sessionId: input.session_id ?? "unknown", source: input.source ?? "startup" }))); }
  catch (error) { console.log(JSON.stringify({ continue: false, stopReason: `SESSION_BINDING_FAILED:${error.message}` })); }
}
