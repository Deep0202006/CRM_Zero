import { loadState, readHookInput, repositoryIdentity, sanitizedFailureSignature, updateState } from "./state-store.mjs";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findActiveTask, taskDirectory, writeTaskArtifact, appendProgress } from "../task-state.mjs";
import { root, sha256 } from "../kernel-lib.mjs";
import { invalidatePrepushCertificate, isGitStateChangingCommand, isGitStateRevalidationCommand, recordFailure, recordMetricEvent } from "../experience.mjs";
const input = await readHookInput(), sessionId = input.session_id ?? "unknown", state = loadState(sessionId), result = input.tool_response ?? input.tool_result ?? {};
const exitCode = Number(result.exit_code ?? result.exitCode ?? (input.is_error || result.isError ? 1 : 0));
const signature = exitCode ? sanitizedFailureSignature({ tool: input.tool_name, input: input.tool_input, exitCode, stdout: result.stdout ?? result.output, stderr: result.stderr ?? result.error }) : null;
const repository = repositoryIdentity(), changed = JSON.stringify(repository) !== JSON.stringify(state.repository), activeTask = findActiveTask(), shellCommand = String(input.tool_input?.cmd ?? input.tool_input?.command ?? ""), gitFailed = Boolean(exitCode && isGitStateChangingCommand(shellCommand)), gitRevalidated = !exitCode && isGitStateRevalidationCommand(shellCommand);
updateState(sessionId, (current) => ({ ...current, repository, evidence: changed ? [] : current.evidence, status: changed ? "LOCAL_PROOFS_REQUIRED" : current.status, failureSignatures: signature ? [...new Set([...(state.failureSignatures ?? []), signature])] : state.failureSignatures, gitRevalidationRequired: gitFailed ? true : gitRevalidated ? false : current.gitRevalidationRequired }));
if (activeTask && changed) invalidatePrepushCertificate(activeTask.taskId, "REPOSITORY_IDENTITY_CHANGED");
if (activeTask && exitCode) recordFailure({ taskId: activeTask.taskId, signature: result.stderr ?? result.error ?? result.stdout ?? result.output ?? `${input.tool_name}:${exitCode}`, evidenceRefs: [`tool:${input.tool_name ?? "unknown"}`], environment: { platform: process.platform } });
if (activeTask && !exitCode && /\bgit(?:\.exe)?\s+push\s+origin\s+(?:feat|fix|chore)\//i.test(shellCommand)) recordMetricEvent(activeTask.taskId, { type: "push", key: repository.headSha });
if (!exitCode && activeTask) {
  const serialized = JSON.stringify(input.tool_input ?? {}).replaceAll("\\", "/"), requested = [...serialized.matchAll(/(?:^|[^A-Za-z0-9_.-])((?:src|scripts|docs|e2e|supabase|\.github|\.codex)\/[A-Za-z0-9_.\[\]/-]+|\.gitignore|(?:AGENTS|CLAUDE|package(?:-lock)?)\.(?:md|json))/g)].map((match) => match[1]), planPath = resolve(taskDirectory(activeTask.taskId), "plan.json"), plan = JSON.parse(readFileSync(planPath, "utf8")), requestedSet = new Set(requested);
  let refreshed = false; plan.writeScope = (plan.writeScope ?? []).map((item) => { if (!requestedSet.has(item.path)) return item; const absolute = resolve(root, item.path), contentHash = existsSync(absolute) ? sha256(readFileSync(absolute)) : "ABSENT"; refreshed ||= contentHash !== item.contentHash; return { ...item, contentHash }; });
  if (refreshed) { writeTaskArtifact(activeTask.taskId, "plan.json", plan); appendProgress(activeTask.taskId, { event: "WRITE_SCOPE_HASH_REFRESHED", paths: requested }); }
}
