import { doctor } from "../kernel-doctor.mjs";
import { findActiveTask, taskDirectory } from "../task-state.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadState, readHookInput, repositoryIdentity, updateState } from "./state-store.mjs";
const input = await readHookInput(), sessionId = input.session_id ?? "unknown", current = loadState(sessionId), health = doctor();
updateState(sessionId, () => ({ ...current, repository: repositoryIdentity(), status: health.failures.length ? "SAFETY_CONFLICT" : current.status }));
const activeTask = findActiveTask(), handoffPath = activeTask ? resolve(taskDirectory(activeTask.taskId), "handoff.md") : null, handoff = handoffPath && existsSync(handoffPath) ? readFileSync(handoffPath, "utf8").slice(0, 4000) : null;
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: JSON.stringify({ kernel: health.status, status: current.status, completionClaim: false, activeTask: activeTask ? { taskId: activeTask.taskId, status: activeTask.status, revision: activeTask.revision, handoff } : null }) } }));
