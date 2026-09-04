import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendProgress, synchronizeTaskHead, taskDirectory, writeTaskArtifact } from "../task-state.mjs";
import { root, sha256 } from "../kernel-lib.mjs";
import { invalidatePrepushCertificate, isGitStateChangingCommand, isGitStateRevalidationCommand, recordFailure, recordMetricEvent } from "../experience.mjs";
import { readHookInput, repositoryIdentity, resolveBoundTask, sanitizedFailureSignature, updateState } from "./state-store.mjs";

export const processPostTool = (input) => {
  const sessionId = input.session_id ?? "unknown", binding = resolveBoundTask(sessionId), state = binding.state, activeTask = binding.task, result = input.tool_response ?? input.tool_result ?? {};
  const exitCode = Number(result.exit_code ?? result.exitCode ?? (input.is_error || result.isError ? 1 : 0)), signature = exitCode ? sanitizedFailureSignature({ tool: input.tool_name, input: input.tool_input, exitCode, stdout: result.stdout ?? result.output, stderr: result.stderr ?? result.error }) : null;
  const repository = repositoryIdentity(), changed = JSON.stringify(repository) !== JSON.stringify(state.repository), shellCommand = String(input.tool_input?.cmd ?? input.tool_input?.command ?? ""), gitFailed = Boolean(exitCode && isGitStateChangingCommand(shellCommand)), gitRevalidated = !exitCode && isGitStateRevalidationCommand(shellCommand);
  updateState(sessionId, (current) => ({ ...current, repository, status: changed ? "LOCAL_PROOFS_REQUIRED" : current.status, gitRevalidationRequired: gitFailed ? true : gitRevalidated ? false : current.gitRevalidationRequired }));
  if (changed) { invalidatePrepushCertificate(activeTask.taskId, "REPOSITORY_IDENTITY_CHANGED"); synchronizeTaskHead(activeTask.taskId, repository); }
  if (exitCode) { appendProgress(activeTask.taskId, { event: "TOOL_FAILURE", tool: input.tool_name ?? "unknown", signature }); recordFailure({ taskId: activeTask.taskId, signature: result.stderr ?? result.error ?? result.stdout ?? result.output ?? `${input.tool_name}:${exitCode}`, evidenceRefs: [`tool:${input.tool_name ?? "unknown"}`], environment: { platform: process.platform } }); }
  if (!exitCode && /\bgit(?:\.exe)?\s+push\s+origin\s+(?:feat|fix|chore)\//i.test(shellCommand)) recordMetricEvent(activeTask.taskId, { type: "push", key: repository.headSha });
  if (!exitCode) {
    const serialized = JSON.stringify(input.tool_input ?? {}).replaceAll("\\", "/"), requested = [...serialized.matchAll(/(?:^|[^A-Za-z0-9_.-])((?:src|scripts|docs|e2e|supabase|\.github|\.codex)\/[A-Za-z0-9_.\[\]/-]+|\.gitignore|(?:AGENTS|CLAUDE|package(?:-lock)?)\.(?:md|json))/g)].map((match) => match[1]), plan = JSON.parse(readFileSync(resolve(taskDirectory(activeTask.taskId), "plan.json"), "utf8")), requestedSet = new Set(requested);
    let refreshed = false; plan.writeScope = (plan.writeScope ?? []).map((item) => { if (!requestedSet.has(item.path)) return item; const absolute = resolve(root, item.path), contentHash = existsSync(absolute) ? sha256(readFileSync(absolute)) : "ABSENT"; refreshed ||= contentHash !== item.contentHash; return { ...item, contentHash }; });
    if (refreshed) { writeTaskArtifact(activeTask.taskId, "plan.json", plan); appendProgress(activeTask.taskId, { event: "WRITE_SCOPE_HASH_REFRESHED", paths: requested }); }
  }
  return { taskId: activeTask.taskId, changed, exitCode };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { processPostTool(await readHookInput()); }
  catch (error) { console.log(JSON.stringify({ systemMessage: `SAFETY_CONFLICT:${error.message}` })); }
}
