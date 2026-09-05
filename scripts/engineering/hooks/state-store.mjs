import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { dirtyFingerprint, git, gitEnvironmentFor, repositoryIdentity, root, sha256 } from "../kernel-lib.mjs";
import { isTaskTerminal, listTasks, loadTask, normalizeLiteralPath, readTaskSnapshot, stateRoot, taskDirectory } from "../task-state.mjs";
import { inspectWorkspaceSuitability } from "../task-controller.mjs";

const Status = z.enum(["AWAITING_TASK", "RECOVERY_REQUIRED", "CONTEXT_REREAD_REQUIRED", "SCOPE_UNRESOLVED", "IMPLEMENTATION_IN_PROGRESS", "LOCAL_PROOFS_REQUIRED", "PR_REQUIRED", "REMOTE_PENDING", "REMOTE_FAILED", "EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT", "READY_TO_END", "STALL_LIMIT"]);
const Repository = z.object({ headSha: z.string(), treeSha: z.string(), baseSha: z.string(), dirtyFingerprint: z.string() });
const ContextPointer = z.object({ schemaVersion: z.literal(1), taskId: z.string(), revision: z.number().int().nonnegative(), path: z.string(), byteCount: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/), resumeStatus: Status.optional() }).strict();
const ContextAck = z.object({ taskId: z.string(), revision: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/), acknowledgedAt: z.string() }).strict();
const PromptRecord = z.object({ sequence: z.number().int().positive(), disposition: z.enum(["STATUS", "CONTINUATION", "AMENDMENT", "NEW_TASK", "RESUME_CURRENT_WORKSPACE", "OWNER_RELEASE"]), sha256: z.string().regex(/^[0-9a-f]{64}$/), byteCount: z.number().int().nonnegative() }).strict();
const State = z.object({
  schemaVersion: z.literal(2), sessionId: z.string().min(1), revision: z.number().int().nonnegative(), status: Status,
  boundTaskId: z.string().optional(), baseline: Repository.optional(), repository: Repository.optional(), contextPointer: ContextPointer.optional(), contextAck: ContextAck.optional(),
  promptSequence: z.number().int().nonnegative().default(0), lastPrompt: PromptRecord.optional(), stallCount: z.number().int().nonnegative().default(0), progressSignature: z.string().optional(), gitRevalidationRequired: z.boolean().default(false),
}).strict();

const safeId = (value) => String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
export const sessionsDirectory = () => process.env.ZD_OS_SESSION_ROOT || resolve(root, git("rev-parse", "--git-path", "zd-kernel/sessions"));
export const sessionPath = (sessionId) => resolve(sessionsDirectory(), `${safeId(sessionId)}.json`);
const initial = (sessionId) => State.parse({ schemaVersion: 2, sessionId: safeId(sessionId), revision: 0, status: "AWAITING_TASK", stallCount: 0, gitRevalidationRequired: false });
const readStored = (sessionId) => {
  const path = sessionPath(sessionId); if (!existsSync(path)) return { path, raw: null, value: initial(sessionId) };
  const raw = readFileSync(path, "utf8"); let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`STATE_CORRUPT:${sha256(raw).slice(0, 12)}`); }
  if (parsed.schemaVersion === 1) return { path, raw, legacy: parsed };
  try { return { path, raw, value: State.parse(parsed) }; } catch { throw new Error(`STATE_CORRUPT:${sha256(raw).slice(0, 12)}`); }
};
export const loadState = (sessionId) => { const stored = readStored(sessionId); if (stored.legacy) throw new Error("LEGACY_SESSION_MIGRATION_REQUIRED"); return stored.value; };
const wait = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const processAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const removeStaleLock = (path) => {
  try {
    const raw = readFileSync(path, "utf8"), lock = JSON.parse(raw), age = Date.now() - Date.parse(lock.createdAt);
    if (!Number.isInteger(lock.pid) || typeof lock.token !== "string" || !Number.isFinite(age) || age < 30_000 || processAlive(lock.pid)) return false;
    if (readFileSync(path, "utf8") !== raw) return false;
    rmSync(path, { force: true }); return true;
  } catch { return false; }
};
const acquire = (path) => {
  const deadline = Date.now() + 2_000, token = randomUUID(); let delay = 5;
  while (Date.now() < deadline) {
    try { const handle = openSync(path, "wx", 0o600); try { writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token })); } catch (error) { closeSync(handle); rmSync(path, { force: true }); throw error; } return { handle, token }; }
    catch (error) { if (error.code !== "EEXIST") throw error; removeStaleLock(path); wait(delay); delay = Math.min(delay * 2, 80); }
  }
  throw new Error("STATE_LOCK_TIMEOUT");
};
const writeState = (path, state) => {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`, output = openSync(temp, "wx", 0o600);
  try { writeFileSync(output, `${JSON.stringify(State.parse(state))}\n`); fsyncSync(output); } finally { closeSync(output); }
  renameSync(temp, path);
};
const withSessionLock = (sessionId, work) => {
  const path = sessionPath(sessionId), lockPath = `${path}.lock`; mkdirSync(dirname(path), { recursive: true }); const { handle, token } = acquire(lockPath);
  try { return work(path); } finally { closeSync(handle); try { if (JSON.parse(readFileSync(lockPath, "utf8")).token === token) rmSync(lockPath, { force: true }); } catch {} }
};
export const compareAndSwap = (sessionId, expectedRevision, update) => withSessionLock(sessionId, (path) => {
  const stored = readStored(sessionId); if (stored.legacy) throw new Error("LEGACY_SESSION_MIGRATION_REQUIRED"); const current = stored.value;
  if (current.revision !== expectedRevision) throw new Error(`STATE_STALE_WRITE:${expectedRevision}:${current.revision}`);
  const next = State.parse({ ...current, ...update, schemaVersion: 2, sessionId: current.sessionId, revision: current.revision + 1 }); writeState(path, next); return next;
});
export const updateState = (sessionId, transform) => { const current = loadState(sessionId); return compareAndSwap(sessionId, current.revision, transform(current)); };
export const currentBindingIdentity = () => ({ branch: git("branch", "--show-current"), worktree: git("rev-parse", "--show-toplevel"), repositoryCommonGitDir: git("rev-parse", "--path-format=absolute", "--git-common-dir"), repository: repositoryIdentity() });
const taskCommonGitDir = (task) => {
  if (task.repositoryCommonGitDir) return task.repositoryCommonGitDir;
  try { return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: task.worktree, encoding: "utf8", env: gitEnvironmentFor(task.worktree) }).trim(); }
  catch { throw new Error("TASK_WORKTREE_MISMATCH"); }
};
const withTaskCreationLock = (work) => {
  const directory = stateRoot(), path = resolve(directory, ".session-task-creation.lock"); mkdirSync(directory, { recursive: true }); const { handle, token } = acquire(path);
  try { return work(); } finally { closeSync(handle); try { if (JSON.parse(readFileSync(path, "utf8")).token === token) rmSync(path, { force: true }); } catch {} }
};
const historyContainsRecordedHead = (task, identity) => {
  if (task.headSha === identity.repository.headSha) return true;
  return spawnSync("git", ["merge-base", "--is-ancestor", task.headSha, identity.repository.headSha], { cwd: identity.worktree, encoding: "utf8", env: gitEnvironmentFor(identity.worktree) }).status === 0;
};
export const assertTaskCompatibility = (task, identity = currentBindingIdentity(), { allowTerminal = false } = {}) => {
  if (normalizeLiteralPath(taskCommonGitDir(task)) !== normalizeLiteralPath(identity.repositoryCommonGitDir)) throw new Error("TASK_REPOSITORY_MISMATCH");
  if (task.branch !== identity.branch) throw new Error("TASK_BRANCH_MISMATCH");
  if (normalizeLiteralPath(task.worktree) !== normalizeLiteralPath(identity.worktree)) throw new Error("TASK_WORKTREE_MISMATCH");
  if (!allowTerminal && isTaskTerminal(task.taskId)) throw new Error("SESSION_TASK_TERMINAL");
  if (!historyContainsRecordedHead(task, identity)) throw new Error("TASK_HISTORY_DIVERGED");
  return task;
};
const compatible = (identity) => listTasks({ unfinishedOnly: true }).filter((task) => task.branch === identity.branch && normalizeLiteralPath(task.worktree) === normalizeLiteralPath(identity.worktree)).map((task) => assertTaskCompatibility(task, identity));
const writeBinding = (path, current, task, identity, statusOverride) => {
  const status = statusOverride ?? (task ? (["AWAITING_TASK", "RECOVERY_REQUIRED", "SCOPE_UNRESOLVED"].includes(current.status) ? "IMPLEMENTATION_IN_PROGRESS" : current.status) : "AWAITING_TASK"), candidate = State.parse({ ...current, schemaVersion: 2, boundTaskId: task?.taskId, repository: identity.repository, baseline: current.baseline ?? identity.repository, status, contextPointer: task ? current.contextPointer : undefined, contextAck: task ? current.contextAck : undefined });
  if (JSON.stringify(candidate) === JSON.stringify(current)) return current;
  const next = State.parse({ ...candidate, revision: current.revision + 1 }); writeState(path, next); return next;
};
export const resolveOrBindSessionTask = (sessionId, { exactTaskId, identity: suppliedIdentity } = {}) => withSessionLock(sessionId, (path) => {
  const stored = readStored(sessionId); let current = stored.value;
  const identity = suppliedIdentity ?? currentBindingIdentity();
  if (stored.legacy) {
    const matches = compatible(identity); if (matches.length > 1) throw new Error(`LEGACY_SESSION_BINDING_AMBIGUOUS:${matches.length}`);
    const preserved = `${path}.v1-preserved-${sha256(stored.raw).slice(0, 12)}.json`; if (!existsSync(preserved)) copyFileSync(path, preserved);
    current = { ...initial(sessionId), revision: Number.isInteger(stored.legacy.revision) ? stored.legacy.revision : 0, boundTaskId: matches[0]?.taskId };
  }
  let task = null;
  if (current.boundTaskId) {
    let candidate; try { candidate = loadTask(current.boundTaskId); if (!isTaskTerminal(candidate.taskId)) task = assertTaskCompatibility(candidate, identity); } catch (error) { if (error.code === "ENOENT") throw new Error("TASK_DISCOVERY_CORRUPT"); throw error; }
  }
  if (exactTaskId) {
    if (task && task.taskId !== exactTaskId) throw new Error("CONTINUATION_TASK_MISMATCH");
    if (!task) { try { task = assertTaskCompatibility(loadTask(exactTaskId), identity); } catch (error) { if (error.code === "ENOENT") throw new Error("CONTINUATION_TASK_MISMATCH"); throw error; } }
  }
  if (!task) {
    const matches = compatible(identity); if (matches.length > 1) throw new Error(`SESSION_BINDING_AMBIGUOUS:${matches.length}`); task = matches[0] ?? null;
  }
  if (task) return { state: writeBinding(path, current, task, identity), task, resolution: current.boundTaskId === task.taskId ? "REUSED" : "BOUND" };
  const workspace = inspectWorkspaceSuitability({ current: { branch: identity.branch, worktree: identity.worktree, repositoryCommonGitDir: identity.repositoryCommonGitDir, ...identity.repository }, mode: "recovery" });
  const historicalExact = listTasks({ unfinishedOnly: false }).some((candidate) => isTaskTerminal(candidate.taskId) && candidate.branch === identity.branch && normalizeLiteralPath(candidate.worktree) === normalizeLiteralPath(identity.worktree));
  const recoverable = workspace.suitable && !historicalExact;
  const state = writeBinding(path, current, null, identity, recoverable ? "RECOVERY_REQUIRED" : "AWAITING_TASK");
  return { state, task: null, resolution: recoverable ? "RECOVERY_REQUIRED" : "AWAITING_TASK", recovery: recoverable ? { intent: "RESUME_CURRENT_WORKSPACE", reason: "NO_COMPATIBLE_TASK" } : undefined };
});
export const bindSession = (sessionId, options = {}) => resolveOrBindSessionTask(sessionId, options);
export const bindTask = (sessionId, taskId, { identity = currentBindingIdentity() } = {}) => withSessionLock(sessionId, (path) => {
  const stored = readStored(sessionId); if (stored.legacy) throw new Error("LEGACY_SESSION_MIGRATION_REQUIRED"); const current = stored.value, task = assertTaskCompatibility(loadTask(taskId), identity);
  if (current.boundTaskId && current.boundTaskId !== taskId) { const previous = assertTaskCompatibility(loadTask(current.boundTaskId), identity, { allowTerminal: true }); if (!isTaskTerminal(previous.taskId)) throw new Error(`SESSION_ACTIVE_TASK_EXISTS:${previous.taskId}`); }
  const next = State.parse({ ...current, boundTaskId: taskId, repository: identity.repository, baseline: current.baseline ?? identity.repository, status: "IMPLEMENTATION_IN_PROGRESS", contextPointer: undefined, contextAck: undefined, revision: current.revision + 1 }); writeState(path, next); return { state: next, task };
});
export const createAndBindSessionTask = (sessionId, create, { identity = currentBindingIdentity(), reuseExisting = false } = {}) => withTaskCreationLock(() => withSessionLock(sessionId, (path) => {
  const stored = readStored(sessionId); if (stored.legacy) throw new Error("LEGACY_SESSION_MIGRATION_REQUIRED"); const current = stored.value; identity = currentBindingIdentity();
  if (current.boundTaskId) { const previous = assertTaskCompatibility(loadTask(current.boundTaskId), identity, { allowTerminal: true }); if (!isTaskTerminal(previous.taskId)) throw new Error(`SESSION_ACTIVE_TASK_EXISTS:${previous.taskId}`); }
  const matches = compatible(identity); if (matches.length > 1) throw new Error(`SESSION_BINDING_AMBIGUOUS:${matches.length}`); if (matches.length) { if (!reuseExisting) throw new Error(`NEW_TASK_ACTIVE_TASK_EXISTS:${matches[0].taskId}`); const state = writeBinding(path, current, matches[0], identity); return { state, task: matches[0], resolution: "BOUND" }; }
  const beforeTaskIds = new Set(existsSync(stateRoot()) ? readdirSync(stateRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name) : []); let created;
  try {
    created = create(); const task = assertTaskCompatibility(created.task ?? created, identity);
    if (process.env.ZD_OS_FAULT_AFTER_TASK_CREATE === "1" && process.env.ZD_OS_STATE_ROOT) throw new Error("INJECTED_BINDING_WRITE_FAILURE");
    const next = State.parse({ ...current, boundTaskId: task.taskId, repository: identity.repository, baseline: current.baseline ?? identity.repository, status: "IMPLEMENTATION_IN_PROGRESS", contextPointer: undefined, contextAck: undefined, revision: current.revision + 1 }); writeState(path, next); return { ...created, state: next, task };
  } catch (error) {
    const owned = created?.task?.taskId ?? created?.taskId; const candidates = owned ? [owned] : readdirSync(stateRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !beforeTaskIds.has(entry.name)).map((entry) => entry.name); for (const taskId of candidates) { try { const task = loadTask(taskId); if (task.branch === identity.branch && normalizeLiteralPath(task.worktree) === normalizeLiteralPath(identity.worktree)) rmSync(taskDirectory(taskId), { recursive: true, force: true }); } catch {} }
    throw error;
  }
}));
export const resolveBoundTask = (sessionId, { identity = currentBindingIdentity(), allowTerminal = false } = {}) => { const state = loadState(sessionId); if (!state.boundTaskId) throw new Error("SESSION_TASK_UNBOUND"); return { state, task: assertTaskCompatibility(loadTask(state.boundTaskId), identity, { allowTerminal }) }; };
export const requireContextReread = (sessionId, pointer) => updateState(sessionId, (current) => ({ ...current, status: "CONTEXT_REREAD_REQUIRED", contextPointer: { ...pointer, resumeStatus: current.status }, contextAck: undefined }));
export const contextRereadPending = (state) => Boolean(state.contextPointer && (!state.contextAck || state.contextAck.taskId !== state.contextPointer.taskId || state.contextAck.revision !== state.contextPointer.revision || state.contextAck.sha256 !== state.contextPointer.sha256));
export const acknowledgeContextReread = (sessionId) => {
  const current = loadState(sessionId), pointer = current.contextPointer; if (!pointer) throw new Error("CONTEXT_POINTER_MISSING");
  const bytes = readFileSync(pointer.path); if (bytes.byteLength !== pointer.byteCount || sha256(bytes) !== pointer.sha256) throw new Error("CONTEXT_POINTER_DRIFT");
  const snapshot = readTaskSnapshot(pointer.taskId); if (snapshot.revision !== pointer.revision) throw new Error("CONTEXT_POINTER_REVISION_DRIFT");
  return compareAndSwap(sessionId, current.revision, { status: pointer.resumeStatus ?? "IMPLEMENTATION_IN_PROGRESS", contextAck: { taskId: pointer.taskId, revision: pointer.revision, sha256: pointer.sha256, acknowledgedAt: new Date().toISOString() } });
};
export const readSessionState = (sessionId) => { const stored = readStored(sessionId); return stored.legacy ? { schemaVersion: 1, sessionId: safeId(sessionId), migrationRequired: true } : stored.value; };
export const sanitizedFailureSignature = ({ tool, input, exitCode, stdout, stderr }) => createHash("sha256").update(JSON.stringify({ tool, inputHash: sha256(JSON.stringify(input ?? {})), exitCode, stdoutHash: sha256(String(stdout ?? "")), stderrHash: sha256(String(stderr ?? "")) })).digest("hex");
export const readHookInput = async () => { let raw = ""; for await (const chunk of process.stdin) raw += chunk; try { return JSON.parse(raw || "{}"); } catch { throw new Error("HOOK_INPUT_INVALID"); } };
export { dirtyFingerprint, repositoryIdentity, root, sha256 };
