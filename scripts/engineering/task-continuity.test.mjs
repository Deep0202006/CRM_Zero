import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { serializeSessionContext } from "./experience.mjs";
import { git, gitEnvironmentFor, repositoryIdentity, root, sha256 } from "./kernel-lib.mjs";
import { makeEngineeringTemp, removeEngineeringTemp } from "./managed-paths.mjs";
import { appendProgress, createTask, loadTask, nextTaskId, readTaskSnapshot, taskDirectory, updateTaskState } from "./task-state.mjs";
import { contextRereadPending, loadState, sessionPath } from "./hooks/state-store.mjs";

const taskRoot = makeEngineeringTemp("continuity-task-state"), sessionRoot = makeEngineeringTemp("continuity-session-state"), previousTaskRoot = process.env.ZD_OS_STATE_ROOT, previousSessionRoot = process.env.ZD_OS_SESSION_ROOT, suffix = randomUUID().slice(0, 8), fixtureBranch = `chore/v6a-hook-fixture-${suffix}`;
const repository = dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir")), fixture = resolve(repository, ".worktrees", `v6a-hook-fixture-${suffix}`), gitAt = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnvironmentFor(cwd), maxBuffer: 64 << 20 }).trim();
process.env.ZD_OS_STATE_ROOT = taskRoot; process.env.ZD_OS_SESSION_ROOT = sessionRoot;

const hook = (name, input) => {
  const result = spawnSync(process.execPath, [`scripts/engineering/hooks/${name}.mjs`], { cwd: fixture, encoding: "utf8", env: process.env, input: JSON.stringify(input) });
  assert.equal(result.status, 0, `${name}: ${result.stderr || result.stdout}`); const output = result.stdout.trim(); return output ? JSON.parse(output) : null;
};
const cli = (args) => spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8", env: process.env });
const automatic = (result) => JSON.parse(result.hookSpecificOutput.additionalContext);
const scopeEntry = (path) => ({ path, contentHash: sha256(readFileSync(resolve(fixture, path))), reason: "fixture" });
const prepare = (taskId, packageAdds = []) => {
  const task = loadTask(taskId), revision = task.revision + 1;
  return updateTaskState(taskId, task.revision, { taskPatch: { status: "IMPLEMENTATION_READY" }, artifacts: {
    "acceptance.json": { schemaVersion: 1, revision, observableOutcome: "fixture", nonGoals: ["product mutation"], items: [{ id: 1, text: "hook lifecycle", status: "PASS", evidence: "child-process" }] },
    "plan.json": { schemaVersion: 1, revision, reproduction: "child hook", rootCause: "fixture", affectedAuthority: [], capabilitiesReused: [], writeScope: [scopeEntry("scripts/engineering/task-state.mjs"), scopeEntry("package.json"), scopeEntry("package-lock.json")], protectedPaths: ["src/**", "supabase/**"], risk: "R3", focusedProof: ["kernel-control-unit"], packageAdds, amendments: [], preparationRequired: false },
    "proof.json": { schemaVersion: 1, revision, requirementsRevision: task.requirementsRevision ?? 0, focusedRuns: [{ proofId: "kernel-control-unit", status: "PASS", head: task.headSha }], broadRuns: [], historicalRuns: [], proofsInvalidated: 0, invalidatedProofIds: [] },
    "delivery.json": { schemaVersion: 1, revision, status: "READY_FOR_RELEASE_APPROVAL", pr: 999, head: task.headSha },
  }, progress: [{ event: "FIXTURE_PREPARED" }] });
};

try {
  gitAt(root, "worktree", "add", "-b", fixtureBranch, fixture, "HEAD");
  cpSync(resolve(root, "scripts/engineering"), resolve(fixture, "scripts/engineering"), { recursive: true, force: true }); cpSync(resolve(root, "docs/engineering"), resolve(fixture, "docs/engineering"), { recursive: true, force: true }); cpSync(resolve(root, "docs/contracts/engineering-os.md"), resolve(fixture, "docs/contracts/engineering-os.md"), { force: true }); cpSync(resolve(root, "package.json"), resolve(fixture, "package.json"), { force: true }); cpSync(resolve(root, "AGENTS.md"), resolve(fixture, "AGENTS.md"), { force: true });
  gitAt(fixture, "config", "user.name", "CRM Hook Fixture"); gitAt(fixture, "config", "user.email", "fixture@example.invalid"); gitAt(fixture, "add", "scripts/engineering", "docs/engineering", "docs/contracts/engineering-os.md", "package.json", "AGENTS.md"); const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: fixture, encoding: "utf8", env: gitEnvironmentFor(fixture) }); if (staged.status === 1) gitAt(fixture, "commit", "-m", "test: current V6A hook fixture"); else assert.equal(staged.status, 0, staged.stderr);
  const identity = { branch: fixtureBranch, worktree: fixture, ...repositoryIdentity(fixture) }, sessionId = `fresh-${suffix}`;

  const zero = automatic(hook("session-start", { session_id: sessionId, source: "startup" })); assert.equal(zero.sessionStatus, "AWAITING_TASK"); assert.equal(zero.boundTaskId, null); assert.equal(zero.taskBootstrap.required, true);
  assert.equal(hook("pre-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: "git status --short" } }), null);
  assert.equal(hook("pre-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: "npm run crm:task -- --task \"Create hook lifecycle fixture\"" } }), null);
  assert.match(hook("pre-tool", { session_id: sessionId, tool_name: "apply_patch", tool_input: { patch: "fixture" } }).hookSpecificOutput.permissionDecisionReason, /SESSION_TASK_UNBOUND/);

  const bootstrapCommand = "npm run crm:task -- --task \"Create engineering control hook fixture\"", bootstrap = cli(["scripts/engineering/task-controller.mjs", "--task", "Create engineering control hook fixture"]); assert.equal(bootstrap.status, 0, bootstrap.stderr); const taskId = JSON.parse(bootstrap.stdout).task.taskId, retry = cli(["scripts/engineering/task-controller.mjs", "--task", "Create engineering control hook fixture"]); assert.equal(retry.status, 0, retry.stderr); assert.equal(JSON.parse(retry.stdout).task.taskId, taskId);
  assert.equal(hook("post-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: bootstrapCommand }, tool_response: { exit_code: 0, stdout: bootstrap.stdout, stderr: "" } }), null); assert.equal(loadState(sessionId).boundTaskId, taskId);
  const resumed = automatic(hook("session-start", { session_id: sessionId, source: "resume" })); assert.equal(resumed.boundTaskId, taskId); assert.equal(resumed.task.taskId, taskId);
  const beforeStatus = loadTask(taskId).revision, status = automatic(hook("user-prompt", { session_id: sessionId, prompt: "what is the status" })); assert.equal(status.promptDisposition, "STATUS"); assert.equal(loadTask(taskId).revision, beforeStatus);
  const continued = automatic(hook("user-prompt", { session_id: sessionId, prompt: "continue please" })); assert.equal(continued.promptDisposition, "CONTINUATION"); assert.equal(loadTask(taskId).revision, beforeStatus); assert.equal(loadState(sessionId).promptSequence, 2);

  prepare(taskId); const beforeAmendment = loadTask(taskId).revision, requirement = "Add the recovery regression", amendment = automatic(hook("user-prompt", { session_id: sessionId, prompt: requirement })); assert.equal(amendment.promptDisposition, "AMENDMENT");
  const amendedTask = loadTask(taskId), amendedAcceptance = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "acceptance.json"), "utf8")), amendedPlan = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "plan.json"), "utf8")), amendedProof = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "proof.json"), "utf8")), amendedDelivery = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "delivery.json"), "utf8"));
  assert(amendedTask.revision > beforeAmendment); assert.equal(amendedTask.status, "INVESTIGATION_REQUIRED"); assert.equal(amendedAcceptance.items.at(-1).requirementHash, sha256(requirement)); assert.equal(amendedPlan.amendments.at(-1).sequence, 1); assert.equal(amendedProof.focusedRuns.length, 0); assert.deepEqual(amendedProof.invalidatedProofIds, ["kernel-control-unit"]); assert.equal(amendedProof.requirementsRevision, amendedTask.requirementsRevision); assert.equal(amendedDelivery.status, "NOT_PUBLISHED");
  const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWX", rejectedSecret = hook("user-prompt", { session_id: sessionId, prompt: `Persist ${secret}` }); assert.equal(rejectedSecret.continue, false); assert.match(rejectedSecret.stopReason, /TASK_STATE_SENSITIVE_DATA/); for (const name of ["acceptance.json", "progress.jsonl", "snapshot.json", "handoff.md"]) assert(!readFileSync(resolve(taskDirectory(taskId), name), "utf8").includes(secret));
  const stopped = hook("stop", { session_id: sessionId }); assert.match(stopped.reason, new RegExp(`taskId=${taskId}\\b`)); assert.match(stopped.reason, /TASK_AMENDMENT_REQUIRES_PREPARATION/);
  assert.equal(hook("post-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: "git status --short" }, tool_response: { exit_code: 0, stdout: "", stderr: "" } }), null);

  const taskLock = resolve(taskDirectory(taskId), ".lock"); writeFileSync(taskLock, JSON.stringify({ pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00.000Z", token: "stale-task" })); hook("user-prompt", { session_id: sessionId, prompt: "Add stale lock recovery evidence" }); assert(!existsSync(taskLock)); assert.equal(readTaskSnapshot(taskId).amendments.at(-1).sequence, 2);
  const sessionLock = `${sessionPath(sessionId)}.lock`; mkdirSync(dirname(sessionLock), { recursive: true }); writeFileSync(sessionLock, JSON.stringify({ pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00.000Z", token: "stale-session" })); hook("session-start", { session_id: sessionId, source: "stale-lock" }); assert(!existsSync(sessionLock));

  const events = Array.from({ length: 180 }, (_, index) => ({ event: "TASK_AMENDED", amendmentSequence: index + 10, requirementHash: sha256(`overflow-${index}`), requirementBytes: 16, acceptanceId: index + 10 })), beforeOverflow = loadTask(taskId); updateTaskState(taskId, beforeOverflow.revision, { progress: events });
  const overflow = automatic(hook("session-start", { session_id: sessionId, source: "compact" })); assert.equal(overflow.sessionStatus, "CONTEXT_REREAD_REQUIRED"); assert.equal(overflow.contextPointer.taskId, taskId); assert.equal(overflow.contextPointer.byteCount, readFileSync(overflow.contextPointer.path).byteLength); assert.equal(overflow.contextPointer.sha256, sha256(readFileSync(overflow.contextPointer.path))); assert(contextRereadPending(loadState(sessionId)));
  assert.match(hook("pre-tool", { session_id: sessionId, tool_name: "apply_patch", tool_input: { patch: "fixture" } }).hookSpecificOutput.permissionDecisionReason, /CONTEXT_REREAD_REQUIRED/);
  const reread = cli(["scripts/engineering/session-observability.mjs", "--reread", "--session", sessionId]); assert.equal(reread.status, 0, reread.stderr); assert.equal(JSON.parse(reread.stdout).status, "ACKNOWLEDGED");
  assert.equal(hook("post-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: `npm run crm:session:reread -- --session ${sessionId}` }, tool_response: { exit_code: 0, stdout: reread.stdout, stderr: "" } }), null); assert(!contextRereadPending(loadState(sessionId)));

  const sameHandoff = sha256(readFileSync(resolve(taskDirectory(taskId), "handoff.md"))); assert.equal(sameHandoff, sha256(readFileSync(resolve(taskDirectory(taskId), "handoff.md")))); appendProgress(taskId, { event: "DETERMINISM_CHANGE" }); assert.notEqual(sameHandoff, sha256(readFileSync(resolve(taskDirectory(taskId), "handoff.md"))));
  const completed = loadTask(taskId); updateTaskState(taskId, completed.revision, { taskPatch: { status: "COMPLETE" }, progress: [{ event: "TASK_COMPLETED" }] }); const awaiting = automatic(hook("session-start", { session_id: sessionId, source: "completed" })); assert.equal(awaiting.sessionStatus, "AWAITING_TASK"); assert.equal(loadState(sessionId).boundTaskId, undefined);
  const successor = automatic(hook("user-prompt", { session_id: sessionId, prompt: "NEW_TASK: Repair engineering control hook continuity" })), successorId = successor.createdTaskId; assert.notEqual(successorId, taskId); assert.equal(loadState(sessionId).boundTaskId, successorId); assert.equal(readTaskSnapshot(successorId).taskId, successorId);
  const collisionCandidate = nextTaskId("Collision-safe task", fixtureBranch); createTask({ taskId: collisionCandidate, task: "Collision-safe task", identity, context: { schemaVersion: 1, status: "RESOLVED", risk: "R3", domains: ["engineering-control"], authorities: [], capabilities: [], candidatePaths: [], requiredProofRefs: [] } }); assert.notEqual(nextTaskId("Collision-safe task", fixtureBranch), collisionCandidate);

  prepare(successorId, ["zod@4.1.12"]); assert.equal(hook("pre-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: "npm install --save-exact --ignore-scripts --registry=https://registry.npmjs.org zod@4.1.12" } }), null);
  for (const command of ["npm install zod@4.1.12", "npm install --save-exact --ignore-scripts --registry=https://registry.npmjs.org zod@latest", "npm install --save-exact --ignore-scripts --registry=https://evil.invalid zod@4.1.12", "npm install --save-exact --ignore-scripts --registry=https://registry.npmjs.org https://example.invalid/pkg.tgz"]) assert.match(hook("pre-tool", { session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: command } }).hookSpecificOutput.permissionDecisionReason, /COMMAND_POLICY|PACKAGE_ADD_SCOPE/);

  createTask({ taskId: `20260904-ambiguous-${suffix}`, task: "Second unfinished fixture", identity, context: { schemaVersion: 1, status: "RESOLVED", risk: "R3", domains: ["engineering-control"], authorities: [], capabilities: [], candidatePaths: [], requiredProofRefs: [] } }); const ambiguous = hook("session-start", { session_id: `ambiguous-${suffix}`, source: "startup" }); assert.equal(ambiguous.continue, false); assert.match(ambiguous.stopReason, /SESSION_BINDING_AMBIGUOUS/);
  const corruptId = `20260904-corrupt-${suffix}`, corruptPath = resolve(taskRoot, corruptId, "task.json"); mkdirSync(dirname(corruptPath), { recursive: true }); writeFileSync(corruptPath, "{interrupted"); const corrupt = hook("session-start", { session_id: `corrupt-${suffix}`, source: "startup" }); assert.equal(corrupt.continue, false); assert.match(corrupt.stopReason, /TASK_DISCOVERY_CORRUPT/); assert.equal(readFileSync(corruptPath, "utf8"), "{interrupted");

  const pointer = { schemaVersion: 1, taskId: successorId, revision: 1, path: ".tmp/engineering/fixture/snapshot.json", byteCount: 10_000, sha256: "a".repeat(64) }, compact = JSON.parse(serializeSessionContext({ kernel: "V6A", required: "x".repeat(10_000) }, 900, pointer)); assert.equal(compact.contextPointer.sha256, pointer.sha256); assert.throws(() => serializeSessionContext({ token: "unsafe" }), /SESSION_CONTEXT_SENSITIVE_DATA/);
  console.log(JSON.stringify({ code: "TASK_CONTINUITY_CHILD_HOOKS_PASS", hooks: ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"], cases: ["zero-bootstrap", "resume", "status-continuation", "amendment-invalidation", "completed-successor", "ambiguity", "overflow-reread-ack", "secret-exclusion", "stale-lock", "corruption", "package-policy", "handoff-determinism"], taskId, successorId }));
} finally {
  if (previousTaskRoot === undefined) delete process.env.ZD_OS_STATE_ROOT; else process.env.ZD_OS_STATE_ROOT = previousTaskRoot;
  if (previousSessionRoot === undefined) delete process.env.ZD_OS_SESSION_ROOT; else process.env.ZD_OS_SESSION_ROOT = previousSessionRoot;
  if (existsSync(fixture)) spawnSync("git", ["worktree", "remove", "--force", fixture], { cwd: root, encoding: "utf8", env: gitEnvironmentFor(root) });
  spawnSync("git", ["branch", "-D", fixtureBranch], { cwd: root, encoding: "utf8", env: gitEnvironmentFor(root) });
  for (const path of [taskRoot, sessionRoot]) if (existsSync(path)) removeEngineeringTemp(path);
}
