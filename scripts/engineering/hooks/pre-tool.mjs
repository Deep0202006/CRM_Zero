import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { classifyCommand, CommandClass, parseExactPackageAddTokens, parseWorktreeAddTokens } from "../command-policy.mjs";
import { contextRereadPending, loadState, readHookInput, resolveBoundTask, root } from "./state-store.mjs";
import { taskDirectory } from "../task-state.mjs";
import { sha256 } from "../kernel-lib.mjs";
import { assertPrepushReady } from "../readiness.mjs";
import { isGitStateRevalidationCommand } from "../experience.mjs";

const denied = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `SAFETY_CONFLICT:${reason}` } });
export const evaluatePreTool = (input) => {
  const sessionId = input.session_id ?? "unknown", tool = input.tool_name ?? "", payload = input.tool_input ?? {}, serialized = JSON.stringify(payload);
  const editTool = /^(?:apply_patch|Edit|Write)$/.test(tool), shellTool = /^(?:Bash|exec_command)$/.test(tool), shellCommand = String(payload.cmd ?? payload.command ?? ""), classification = shellTool ? classifyCommand(shellCommand) : null;
  const shellMutation = classification && [CommandClass.REPOSITORY_METADATA_ALLOWED, CommandClass.SCOPED_MUTATION_ALLOWED, CommandClass.UNKNOWN_MUTATION_SHAPE, CommandClass.PROHIBITED].includes(classification.classification), mutating = editTool || shellMutation;
  let binding; try { binding = resolveBoundTask(sessionId); } catch (error) {
    if (error.message !== "SESSION_TASK_UNBOUND") return denied(error.message);
    const state = loadState(sessionId), sessionRead = classification?.reason === "NPM_REGISTERED_SCRIPT" && /^npm(?:\.cmd|\.exe)?\s+run\s+crm:session:(?:status|snapshot|reread)(?:\s|$)/i.test(shellCommand), allowed = !editTool && shellTool && (classification?.classification === CommandClass.READ_ONLY_ALLOWED || sessionRead || classification?.reason === "TASK_BOOTSTRAP");
    return allowed && state.status === "AWAITING_TASK" ? null : denied("SESSION_TASK_UNBOUND");
  }
  const { state, task: activeTask } = binding;
  const boundary = JSON.parse(readFileSync(resolve(root, "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json"), "utf8")).immutableThrough;
  const migration = [...serialized.matchAll(/supabase[\\/]migrations[\\/](\d+)_/g)].some((match) => Number(match[1]) <= boundary), credentialPath = /(?:^|[\\/])\.env(?:\.|[\\/]|$)|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_URL|PRODUCTION_|VERCEL_TOKEN/i.test(serialized);
  const controlEdit = mutating && /(?:^|["'\\/])(?:\.codex|\.github|scripts[\\/](?:engineering|quality)|docs[\\/]engineering|AGENTS\.md|CLAUDE\.md|package(?:-lock)?\.json)/i.test(serialized);
  const taskPlan = JSON.parse(readFileSync(resolve(taskDirectory(activeTask.taskId), "plan.json"), "utf8")), taskContext = JSON.parse(readFileSync(resolve(taskDirectory(activeTask.taskId), "context.json"), "utf8")), taskScope = new Map((taskPlan.writeScope ?? []).map((item) => [item.path, item]));
  const taskControlAuthorized = ["IMPLEMENTATION_READY", "LOCAL_PROOFS_REQUIRED"].includes(activeTask.status) && taskPlan.risk === "R3" && taskContext.domains?.includes("engineering-control");
  const packageAdd = classification?.reason === "NPM_EXACT_PACKAGE_ADD" ? parseExactPackageAddTokens(classification.tokens) : null, packagePaths = ["package.json", "package-lock.json"], packageAddAuthorized = packageAdd && taskControlAuthorized && (taskPlan.packageAdds ?? []).includes(packageAdd.packageSpec) && packagePaths.every((path) => { const scoped = taskScope.get(path), absolute = resolve(root, path); return scoped && existsSync(absolute) && scoped.contentHash === sha256(readFileSync(absolute)); });
  const worktreeRequest = classification?.reason === "GIT_WORKTREE_ADD" ? parseWorktreeAddTokens(classification.tokens) : null, worktreeRoot = resolve(root, ".worktrees"), worktreeDestination = worktreeRequest ? resolve(root, worktreeRequest.destination) : "", worktreeRelative = worktreeRequest ? relative(worktreeRoot, worktreeDestination) : "";
  const worktreeAddAuthorized = worktreeRequest && taskControlAuthorized && worktreeRelative && !worktreeRelative.startsWith("..") && !isAbsolute(worktreeRelative) && !existsSync(worktreeDestination);
  const requestedPaths = [...serialized.replaceAll("\\", "/").matchAll(/(?:^|[^A-Za-z0-9_.-])((?:src|scripts|docs|e2e|supabase|\.github|\.codex)\/[A-Za-z0-9_.\[\]/-]+|\.gitignore|(?:AGENTS|CLAUDE|package(?:-lock)?)\.(?:md|json)|[A-Za-z0-9_.-]+\.(?:c?js|mjs|mts|cts|json|toml|ya?ml|md|sql|ts|tsx))/g)].map((match) => match[1]);
  const metadataOnly = ["GIT_COMMIT", "GIT_FEATURE_PUSH", "GIT_FETCH_METADATA", "GITHUB_PR_CREATE"].includes(classification?.reason);
  const outsideTaskScope = mutating && !metadataOnly && !worktreeAddAuthorized && !packageAddAuthorized && (!requestedPaths.length || requestedPaths.some((path) => { const scoped = taskScope.get(path), absolute = resolve(root, path); if (!scoped) return true; if (scoped.contentHash === "ABSENT") return existsSync(absolute); return !existsSync(absolute) || sha256(readFileSync(absolute)) !== scoped.contentHash; }));
  let conflict = "";
  if (classification?.classification === CommandClass.PROHIBITED || classification?.classification === CommandClass.UNKNOWN_MUTATION_SHAPE) conflict = `COMMAND_POLICY_${classification.reason}`;
  else if ((state.status === "CONTEXT_REREAD_REQUIRED" || contextRereadPending(state)) && mutating) conflict = "CONTEXT_REREAD_REQUIRED";
  else if (state.gitRevalidationRequired && mutating && !isGitStateRevalidationCommand(shellCommand)) conflict = "GIT_STATE_REVALIDATION_REQUIRED";
  else if (migration) conflict = "IMMUTABLE_MIGRATION";
  else if (credentialPath) conflict = "CREDENTIAL_PATH";
  else if (mutating && controlEdit && !taskControlAuthorized) conflict = "CONTROL_SCOPE";
  else if (worktreeRequest && !worktreeAddAuthorized) conflict = "WORKTREE_SCOPE";
  else if (packageAdd && !packageAddAuthorized) conflict = "PACKAGE_ADD_SCOPE";
  else if (outsideTaskScope) conflict = "TASK_SCOPE_OR_HASH";
  else if (classification?.reason === "GIT_FEATURE_PUSH") { try { assertPrepushReady(); } catch { conflict = "PREPUSH_CERTIFICATE_REQUIRED"; } }
  return conflict ? denied(conflict) : null;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) { const decision = evaluatePreTool(await readHookInput()); if (decision) console.log(JSON.stringify(decision)); }
