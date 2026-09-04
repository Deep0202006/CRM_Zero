import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendProgress, loadTask, synchronizeTaskHead, taskDirectory, updateTaskState } from "../task-state.mjs";
import { classifyCommand } from "../command-policy.mjs";
import { root, sha256 } from "../kernel-lib.mjs";
import { invalidatePrepushCertificate, isGitStateChangingCommand, isGitStateRevalidationCommand, recordFailure, recordMetricEvent } from "../experience.mjs";
import { acknowledgeContextReread, bindSession, readHookInput, repositoryIdentity, resolveBoundTask, sanitizedFailureSignature, updateState } from "./state-store.mjs";

export const processPostTool = (input) => {
  const sessionId = input.session_id ?? "unknown", result = input.tool_response ?? input.tool_result ?? {}, exitCode = Number(result.exit_code ?? result.exitCode ?? (input.is_error || result.isError ? 1 : 0)), shellCommand = String(input.tool_input?.cmd ?? input.tool_input?.command ?? ""), command = classifyCommand(shellCommand);
  if (!exitCode && command.reason === "NPM_REGISTERED_SCRIPT" && /crm:session:reread/i.test(shellCommand)) acknowledgeContextReread(sessionId);
  let binding; try { binding = resolveBoundTask(sessionId); } catch (error) {
    if (!exitCode && command.reason === "TASK_BOOTSTRAP") binding = bindSession(sessionId);
    else if (error.message === "SESSION_TASK_UNBOUND") return { taskId: null, changed: false, exitCode };
    else throw error;
  }
  if (!binding.task) return { taskId: null, changed: false, exitCode };
  const state = binding.state, activeTask = binding.task, signature = exitCode ? sanitizedFailureSignature({ tool: input.tool_name, input: input.tool_input, exitCode, stdout: result.stdout ?? result.output, stderr: result.stderr ?? result.error }) : null;
  const repository = repositoryIdentity(), changed = JSON.stringify(repository) !== JSON.stringify(state.repository), gitFailed = Boolean(exitCode && isGitStateChangingCommand(shellCommand)), gitRevalidated = !exitCode && isGitStateRevalidationCommand(shellCommand);
  updateState(sessionId, (current) => ({ ...current, repository, status: changed ? "LOCAL_PROOFS_REQUIRED" : current.status, gitRevalidationRequired: gitFailed ? true : gitRevalidated ? false : current.gitRevalidationRequired }));
  if (changed) { invalidatePrepushCertificate(activeTask.taskId, "REPOSITORY_IDENTITY_CHANGED"); synchronizeTaskHead(activeTask.taskId, repository); }
  if (exitCode) { appendProgress(activeTask.taskId, { event: "TOOL_FAILURE", tool: input.tool_name ?? "unknown", signature }); recordFailure({ taskId: activeTask.taskId, signature: result.stderr ?? result.error ?? result.stdout ?? result.output ?? `${input.tool_name}:${exitCode}`, evidenceRefs: [`tool:${input.tool_name ?? "unknown"}`], environment: { platform: process.platform } }); }
  if (!exitCode && /\bgit(?:\.exe)?\s+push\s+origin\s+(?:feat|fix|chore)\//i.test(shellCommand)) recordMetricEvent(activeTask.taskId, { type: "push", key: repository.headSha });
  if (!exitCode) {
    const serialized = JSON.stringify(input.tool_input ?? {}).replaceAll("\\", "/"), requested = [...serialized.matchAll(/(?:^|[^A-Za-z0-9_.-])((?:src|scripts|docs|e2e|supabase|\.github|\.codex)\/[A-Za-z0-9_.\[\]/-]+|\.gitignore|(?:AGENTS|CLAUDE|package(?:-lock)?)\.(?:md|json))/g)].map((match) => match[1]), plan = JSON.parse(readFileSync(resolve(taskDirectory(activeTask.taskId), "plan.json"), "utf8")), requestedSet = new Set(requested);
    let refreshed = false; plan.writeScope = (plan.writeScope ?? []).map((item) => { if (!requestedSet.has(item.path)) return item; const absolute = resolve(root, item.path), contentHash = existsSync(absolute) ? sha256(readFileSync(absolute)) : "ABSENT"; refreshed ||= contentHash !== item.contentHash; return { ...item, contentHash }; });
    if (refreshed) { const task = loadTask(activeTask.taskId); updateTaskState(activeTask.taskId, task.revision, { artifacts: { "plan.json": { ...plan, revision: task.revision + 1 } }, progress: [{ event: "WRITE_SCOPE_HASH_REFRESHED", paths: requested }] }); }
  }
  return { taskId: activeTask.taskId, changed, exitCode };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { processPostTool(await readHookInput()); }
  catch (error) { console.log(JSON.stringify({ systemMessage: `SAFETY_CONFLICT:${error.message}` })); }
}
