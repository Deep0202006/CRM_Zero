import { doctor } from "../kernel-doctor.mjs";
import { findActiveTask, taskDirectory } from "../task-state.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadState, readHookInput, repositoryIdentity, updateState } from "./state-store.mjs";
import { git } from "../kernel-lib.mjs";
import { serializeSessionContext } from "../experience.mjs";
const input = await readHookInput(), sessionId = input.session_id ?? "unknown", current = loadState(sessionId), health = doctor();
updateState(sessionId, () => ({ ...current, repository: repositoryIdentity(), status: health.failures.length ? "SAFETY_CONFLICT" : current.status }));
const activeTask = findActiveTask(), directory = activeTask ? taskDirectory(activeTask.taskId) : null, handoffPath = directory ? resolve(directory, "handoff.md") : null, contextPath = directory ? resolve(directory, "context.json") : null;
const handoff = handoffPath && existsSync(handoffPath) ? readFileSync(handoffPath, "utf8") : "", experiencePacket = contextPath && existsSync(contextPath) ? JSON.parse(readFileSync(contextPath, "utf8")).experiencePacket ?? [] : [], repository = repositoryIdentity();
const additionalContext = serializeSessionContext({
  safetyConflict: health.failures.length ? health.failures[0] : null,
  kernel: health.status,
  sessionStatus: current.status,
  repository: { branch: git("branch", "--show-current"), head: repository.headSha.slice(0, 12), dirty: repository.dirtyFingerprint !== "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  task: activeTask ? { id: activeTask.taskId, status: activeTask.status, revision: activeTask.revision } : null,
  experiencePacket,
  nextAction: activeTask?.status === "IMPLEMENTATION_READY" ? "Implement within task write scope, then focused proof." : activeTask?.status ?? current.status,
  handoff,
});
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
