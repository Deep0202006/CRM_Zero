import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { serializeSessionContext } from "./experience.mjs";
import { git, repositoryIdentity, root, sha256 } from "./kernel-lib.mjs";
import { makeEngineeringTemp, removeEngineeringTemp } from "./managed-paths.mjs";
import { amendTask, appendProgress, createTask, loadTask, readTaskSnapshot, synchronizeTaskHead, taskDirectory, writeTaskArtifact } from "./task-state.mjs";
import { compareAndSwap, bindSession, loadState, readSessionState, resolveBoundTask, sessionPath } from "./hooks/state-store.mjs";
import { startSession } from "./hooks/session-start.mjs";
import { submitUserPrompt } from "./hooks/user-prompt.mjs";
import { evaluatePreTool } from "./hooks/pre-tool.mjs";
import { processPostTool } from "./hooks/post-tool.mjs";
import { sessionSnapshot, sessionStatus } from "./session-observability.mjs";

const stateRoot = makeEngineeringTemp("continuity-task-state"), sessionRoot = makeEngineeringTemp("continuity-session-state"), previousTaskRoot = process.env.ZD_OS_STATE_ROOT, previousSessionRoot = process.env.ZD_OS_SESSION_ROOT;
process.env.ZD_OS_STATE_ROOT = stateRoot; process.env.ZD_OS_SESSION_ROOT = sessionRoot;
const identity = { branch: git("branch", "--show-current"), worktree: git("rev-parse", "--show-toplevel"), ...repositoryIdentity() }, taskId = "20260903-continuity-a", sessionId = `continuity-${randomUUID()}`;
const context = { schemaVersion: 1, status: "RESOLVED", risk: "R3", domains: ["engineering-control"], authorities: [], capabilities: [], candidatePaths: [], requiredProofRefs: ["kernel-control-unit"], experiencePacket: [] };
const tree = (directory) => {
  if (!existsSync(directory)) return [];
  const rows = [], visit = (path) => { for (const name of readdirSync(path)) { const absolute = resolve(path, name), stat = statSync(absolute); if (stat.isDirectory()) visit(absolute); else rows.push([absolute.slice(directory.length).replaceAll("\\", "/"), stat.size, sha256(readFileSync(absolute))]); } };
  visit(directory); return rows.sort(([left], [right]) => left.localeCompare(right));
};

try {
  createTask({ taskId, task: "Prove canonical task continuity", identity, context });
  writeTaskArtifact(taskId, "acceptance.json", { schemaVersion: 1, observableOutcome: "one task", nonGoals: ["product mutation"], items: [{ id: "A", text: "same durable task", status: "PASS", evidence: "fixture:initial" }] });
  writeTaskArtifact(taskId, "plan.json", { schemaVersion: 1, reproduction: "split session identity", rootCause: "second task authority", affectedAuthority: [], capabilitiesReused: [], writeScope: [{ path: "scripts/engineering/task-state.mjs", contentHash: sha256(readFileSync(resolve(root, "scripts/engineering/task-state.mjs"))), reason: "fixture" }], protectedPaths: ["src/**", "supabase/**"], risk: "R3", focusedProof: ["kernel-control-unit"] });
  writeTaskArtifact(taskId, "proof.json", { schemaVersion: 1, focusedRuns: [{ proofId: "kernel-control-unit", status: "PASS", head: identity.headSha }], broadRuns: [], proofsInvalidated: 0 });

  const firstBinding = bindSession(sessionId, { identity }), firstRevision = loadTask(taskId).revision;
  assert.equal(firstBinding.state.boundTaskId, taskId);
  const ordinary = submitUserPrompt({ sessionId, prompt: "you missed the remaining continuity case" });
  assert.equal(JSON.parse(ordinary.hookSpecificOutput.additionalContext).boundTaskId, taskId);
  assert.equal(loadState(sessionId).boundTaskId, taskId);
  assert.equal(readdirSync(stateRoot).filter((name) => existsSync(resolve(stateRoot, name, "task.json"))).length, 1);
  assert(readFileSync(resolve(taskDirectory(taskId), "progress.jsonl"), "utf8").includes("TASK_AMENDED")); const amendedSnapshot = readTaskSnapshot(taskId);
  assert.equal(amendedSnapshot.amendments.length, 1); assert.match(amendedSnapshot.amendments[0].pointer, /progress\.jsonl#sequence=/); assert(!JSON.stringify(amendedSnapshot).includes("you missed the remaining continuity case"));
  const acceptanceAfter = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "acceptance.json"), "utf8")), proofAfter = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "proof.json"), "utf8"));
  assert.equal(acceptanceAfter.items[0].evidence, "fixture:initial"); assert.equal(proofAfter.focusedRuns[0].status, "PASS");
  const amendedRevision = loadTask(taskId).revision; assert(amendedRevision > firstRevision); assert.throws(() => amendTask(taskId, firstRevision, "stale correction"), /TASK_STALE_WRITE/);

  const pre = evaluatePreTool({ session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: "git status --short" } }); assert.equal(pre, null);
  const post = processPostTool({ session_id: sessionId, tool_name: "exec_command", tool_input: { cmd: "git status --short" }, tool_response: { exit_code: 0, stdout: "", stderr: "" } }); assert.equal(post.taskId, taskId);
  const started = JSON.parse(startSession({ sessionId, source: "resume" }).hookSpecificOutput.additionalContext), compacted = JSON.parse(startSession({ sessionId, source: "compact" }).hookSpecificOutput.additionalContext); assert.equal(started.boundTaskId, taskId); assert.equal(compacted.boundTaskId, taskId);
  assert.equal(bindSession(sessionId, { identity }).state.boundTaskId, taskId); assert.equal(bindSession(sessionId, { identity }).state.boundTaskId, taskId);
  assert.throws(() => resolveBoundTask(sessionId, { identity: { ...identity, branch: "fix/wrong" } }), /SESSION_TASK_BRANCH_MISMATCH/);
  assert.throws(() => resolveBoundTask(sessionId, { identity: { ...identity, worktree: `${identity.worktree}-wrong` } }), /SESSION_TASK_WORKTREE_MISMATCH/);

  const sessionBeforeCas = loadState(sessionId); compareAndSwap(sessionId, sessionBeforeCas.revision, { status: "LOCAL_PROOFS_REQUIRED" }); assert.throws(() => compareAndSwap(sessionId, sessionBeforeCas.revision, { status: "REMOTE_PENDING" }), /STATE_STALE_WRITE/);
  const stop = spawnSync(process.execPath, ["scripts/engineering/hooks/stop.mjs"], { cwd: root, encoding: "utf8", env: process.env, input: JSON.stringify({ session_id: sessionId }) });
  assert.equal(stop.status, 0, stop.stderr); const stopOutput = JSON.parse(stop.stdout); assert.match(stopOutput.reason, new RegExp(`taskId=${taskId}\\b`)); assert.match(stopOutput.reason, /TASK_AMENDMENT_REQUIRES_PREPARATION/); assert(!stopOutput.reason.includes("taskId=00000000"));

  const hooks = JSON.parse(readFileSync(resolve(root, ".codex/hooks.json"), "utf8")), sessionLimit = hooks.hooks.SessionStart[0].hooks[0].additionalContextLimit, promptLimit = hooks.hooks.UserPromptSubmit[0].hooks[0].additionalContextLimit;
  assert.equal(sessionLimit, 2500); assert.equal(promptLimit, 2500); const capsule = serializeSessionContext({ boundTaskId: taskId, task: readTaskSnapshot(taskId) }); assert(Buffer.byteLength(capsule) < 9_000); assert.throws(() => serializeSessionContext({ required: "x".repeat(9_000) }), /SESSION_CONTEXT_BUDGET_EXCEEDED/);

  const handoffPath = resolve(taskDirectory(taskId), "handoff.md"), handoffs = [sha256(readFileSync(handoffPath))];
  writeTaskArtifact(taskId, "acceptance.json", { ...acceptanceAfter, items: [...acceptanceAfter.items, { id: "L", text: "handoff changes", status: "PENDING" }] }); handoffs.push(sha256(readFileSync(handoffPath)));
  const planAfter = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "plan.json"), "utf8")); writeTaskArtifact(taskId, "plan.json", { ...planAfter, writeScope: [...planAfter.writeScope, { path: "AGENTS.md", contentHash: sha256(readFileSync(resolve(root, "AGENTS.md"))), reason: "fixture" }] }); handoffs.push(sha256(readFileSync(handoffPath)));
  writeTaskArtifact(taskId, "proof.json", { ...proofAfter, focusedRuns: [...proofAfter.focusedRuns, { proofId: "kernel-preflight", status: "FAIL", head: identity.headSha }] }); handoffs.push(sha256(readFileSync(handoffPath)));
  appendProgress(taskId, { event: "TOOL_FAILURE", signature: "a".repeat(64) }); handoffs.push(sha256(readFileSync(handoffPath)));
  const failedProof = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "proof.json"), "utf8")); writeTaskArtifact(taskId, "proof.json", { ...failedProof, focusedRuns: [...failedProof.focusedRuns, { proofId: "kernel-preflight", status: "PASS", head: identity.headSha }] }); assert(!readTaskSnapshot(taskId).proof.failedOrInvalidated.includes("kernel-preflight")); handoffs.push(sha256(readFileSync(handoffPath)));
  writeTaskArtifact(taskId, "delivery.json", { schemaVersion: 1, status: "REMOTE_PENDING", pr: 999, head: identity.headSha }); handoffs.push(sha256(readFileSync(handoffPath)));
  synchronizeTaskHead(taskId, { headSha: "f".repeat(40), treeSha: "e".repeat(40) }); handoffs.push(sha256(readFileSync(handoffPath))); assert.equal(new Set(handoffs).size, handoffs.length); assert.throws(() => writeTaskArtifact(taskId, "handoff.md", "model prose"), /TASK_ARTIFACT_INVALID/);

  const legacySession = `legacy-${randomUUID()}`, legacyRaw = JSON.stringify({ schemaVersion: 1, sessionId: legacySession, revision: 7, status: "IMPLEMENTATION_IN_PROGRESS", taskId: "00000000-0000-0000-0000-000000000000", taskSequence: 9, scopeRevision: 2, evidence: [], failureSignatures: [], stallCount: 0, gitRevalidationRequired: false });
  mkdirSync(sessionRoot, { recursive: true }); writeFileSync(sessionPath(legacySession), legacyRaw); const migrated = bindSession(legacySession, { identity }); assert.equal(migrated.state.boundTaskId, taskId); assert.notEqual(migrated.state.boundTaskId, "00000000-0000-0000-0000-000000000000"); assert(readdirSync(sessionRoot).some((name) => name.startsWith(`${legacySession}.json.v1-preserved-`)));

  const taskCountBeforeExplicit = readdirSync(stateRoot).filter((name) => existsSync(resolve(stateRoot, name, "task.json"))).length, secondTaskId = "20260903-continuity-b";
  createTask({ taskId: secondTaskId, task: "Explicit second task", identity, context }); assert.equal(readdirSync(stateRoot).filter((name) => existsSync(resolve(stateRoot, name, "task.json"))).length, taskCountBeforeExplicit + 1);
  const ambiguousSession = `legacy-${randomUUID()}`, ambiguousRaw = JSON.stringify({ schemaVersion: 1, sessionId: ambiguousSession, revision: 0, status: "SCOPE_UNRESOLVED", taskId: randomUUID(), evidence: [], failureSignatures: [], stallCount: 0, gitRevalidationRequired: false }); writeFileSync(sessionPath(ambiguousSession), ambiguousRaw);
  assert.throws(() => bindSession(ambiguousSession, { identity }), /LEGACY_SESSION_BINDING_AMBIGUOUS:2/); assert.equal(readFileSync(sessionPath(ambiguousSession), "utf8"), ambiguousRaw);

  const corruptSession = `corrupt-${randomUUID()}`, corruptRaw = "{interrupted"; writeFileSync(sessionPath(corruptSession), corruptRaw); const beforeObservability = { tasks: tree(stateRoot), sessions: tree(sessionRoot) };
  const corruptSnapshot = sessionSnapshot({ sessionId: corruptSession }); assert.match(corruptSnapshot.session.error, /STATE_CORRUPT/); assert.equal(corruptSnapshot.task, null); assert.throws(() => readSessionState(corruptSession), /STATE_CORRUPT/); assert.equal(readFileSync(sessionPath(corruptSession), "utf8"), corruptRaw);
  sessionStatus({ sessionId }); sessionSnapshot({ sessionId }); assert.deepEqual({ tasks: tree(stateRoot), sessions: tree(sessionRoot) }, beforeObservability);
  console.log(JSON.stringify({ code: "TASK_CONTINUITY_A_N_PASS", regressions: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"], taskId }));
} finally {
  if (previousTaskRoot === undefined) delete process.env.ZD_OS_STATE_ROOT; else process.env.ZD_OS_STATE_ROOT = previousTaskRoot;
  if (previousSessionRoot === undefined) delete process.env.ZD_OS_SESSION_ROOT; else process.env.ZD_OS_SESSION_ROOT = previousSessionRoot;
  for (const path of [stateRoot, sessionRoot]) if (existsSync(path)) removeEngineeringTemp(path);
}
