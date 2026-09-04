import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { dirtyFingerprint, git, repositoryIdentity, root, sha256 } from "../kernel-lib.mjs";
import { listCompatibleTasks, loadTask } from "../task-state.mjs";

const Status = z.enum(["SCOPE_UNRESOLVED", "IMPLEMENTATION_IN_PROGRESS", "LOCAL_PROOFS_REQUIRED", "PR_REQUIRED", "REMOTE_PENDING", "REMOTE_FAILED", "EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT", "READY_TO_END", "STALL_LIMIT"]);
const Repository = z.object({ headSha: z.string(), treeSha: z.string(), baseSha: z.string(), dirtyFingerprint: z.string() });
const State = z.object({
  schemaVersion: z.literal(2), sessionId: z.string().min(1), revision: z.number().int().nonnegative(), status: Status,
  boundTaskId: z.string().optional(), baseline: Repository.optional(), repository: Repository.optional(),
  stallCount: z.number().int().nonnegative().default(0), progressSignature: z.string().optional(), gitRevalidationRequired: z.boolean().default(false),
}).strict();

const safeId = (value) => String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
export const sessionsDirectory = () => process.env.ZD_OS_SESSION_ROOT || resolve(root, git("rev-parse", "--git-path", "zd-kernel/sessions"));
export const sessionPath = (sessionId) => resolve(sessionsDirectory(), `${safeId(sessionId)}.json`);
const initial = (sessionId) => State.parse({ schemaVersion: 2, sessionId: safeId(sessionId), revision: 0, status: "SCOPE_UNRESOLVED", stallCount: 0, gitRevalidationRequired: false });
const readStored = (sessionId, { preserveCorrupt = true } = {}) => {
  const path = sessionPath(sessionId); if (!existsSync(path)) return { path, raw: null, value: initial(sessionId) };
  const raw = readFileSync(path, "utf8"); let parsed;
  try { parsed = JSON.parse(raw); } catch {
    if (!preserveCorrupt) throw new Error(`STATE_CORRUPT:${sha256(raw).slice(0, 12)}`);
    const preserved = `${path}.corrupt-${Date.now()}-${sha256(raw).slice(0, 12)}`; renameSync(path, preserved); throw new Error(`STATE_CORRUPT_PRESERVED:${preserved}`);
  }
  if (parsed.schemaVersion === 1) return { path, raw, legacy: parsed };
  return { path, raw, value: State.parse(parsed) };
};
export const loadState = (sessionId) => { const stored = readStored(sessionId); if (stored.legacy) throw new Error("LEGACY_SESSION_MIGRATION_REQUIRED"); return stored.value; };
const acquire = (path, retries = 40) => {
  for (let attempt = 0; attempt < retries; attempt += 1) { try { return openSync(path, "wx", 0o600); } catch (error) { if (error.code !== "EEXIST") throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); } }
  throw new Error("STATE_LOCK_TIMEOUT");
};
const writeState = (path, state) => {
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`, output = openSync(temp, "wx", 0o600);
  try { writeFileSync(output, `${JSON.stringify(State.parse(state))}\n`); fsyncSync(output); } finally { closeSync(output); }
  renameSync(temp, path);
};
const withSessionLock = (sessionId, work) => {
  const path = sessionPath(sessionId), lock = `${path}.lock`; mkdirSync(dirname(path), { recursive: true }); const handle = acquire(lock);
  try { return work(path); } finally { closeSync(handle); if (existsSync(lock)) unlinkSync(lock); }
};
export const compareAndSwap = (sessionId, expectedRevision, update) => withSessionLock(sessionId, (path) => {
  const stored = readStored(sessionId); if (stored.legacy) throw new Error("LEGACY_SESSION_MIGRATION_REQUIRED"); const current = stored.value;
  if (current.revision !== expectedRevision) throw new Error(`STATE_STALE_WRITE:${expectedRevision}:${current.revision}`);
  const next = State.parse({ ...current, ...update, schemaVersion: 2, sessionId: current.sessionId, revision: current.revision + 1 }); writeState(path, next); return next;
});
export const updateState = (sessionId, transform) => { const current = loadState(sessionId); return compareAndSwap(sessionId, current.revision, transform(current)); };
const currentBindingIdentity = () => ({ branch: git("branch", "--show-current"), worktree: git("rev-parse", "--show-toplevel"), repository: repositoryIdentity() });
const normalized = (value) => String(value).replaceAll("\\", "/");
export const assertTaskCompatibility = (task, identity = currentBindingIdentity()) => {
  if (task.branch !== identity.branch) throw new Error(`SESSION_TASK_BRANCH_MISMATCH:${task.branch}:${identity.branch}`);
  if (normalized(task.worktree) !== normalized(identity.worktree)) throw new Error(`SESSION_TASK_WORKTREE_MISMATCH:${task.worktree}:${identity.worktree}`);
  return task;
};
const compatible = (identity) => listCompatibleTasks({ branch: identity.branch, worktree: identity.worktree });
export const bindSession = (sessionId, { identity = currentBindingIdentity() } = {}) => withSessionLock(sessionId, (path) => {
  const stored = readStored(sessionId); let current = stored.value;
  if (stored.legacy) {
    const matches = compatible(identity); if (matches.length !== 1) throw new Error(`LEGACY_SESSION_BINDING_AMBIGUOUS:${matches.length}`);
    const preserved = `${path}.v1-preserved-${sha256(stored.raw).slice(0, 12)}.json`; if (!existsSync(preserved)) copyFileSync(path, preserved);
    current = initial(sessionId); current = { ...current, revision: Number.isInteger(stored.legacy.revision) ? stored.legacy.revision : 0, boundTaskId: matches[0].taskId };
  }
  let task;
  if (current.boundTaskId) task = assertTaskCompatibility(loadTask(current.boundTaskId), identity);
  else { const matches = compatible(identity); if (matches.length !== 1) throw new Error(`SESSION_BINDING_AMBIGUOUS:${matches.length}`); task = matches[0]; }
  const next = State.parse({ ...current, schemaVersion: 2, boundTaskId: task.taskId, repository: identity.repository, baseline: current.baseline ?? identity.repository, status: current.status === "SCOPE_UNRESOLVED" ? "IMPLEMENTATION_IN_PROGRESS" : current.status, revision: current.revision + 1 }); writeState(path, next); return { state: next, task };
});
export const resolveBoundTask = (sessionId, { identity = currentBindingIdentity() } = {}) => { const state = loadState(sessionId); if (!state.boundTaskId) throw new Error("SESSION_TASK_UNBOUND"); return { state, task: assertTaskCompatibility(loadTask(state.boundTaskId), identity) }; };
export const readSessionState = (sessionId) => { const stored = readStored(sessionId, { preserveCorrupt: false }); return stored.legacy ? { schemaVersion: 1, sessionId: safeId(sessionId), migrationRequired: true } : stored.value; };
export const sanitizedFailureSignature = ({ tool, input, exitCode, stdout, stderr }) => createHash("sha256").update(JSON.stringify({ tool, inputHash: sha256(JSON.stringify(input ?? {})), exitCode, stdoutHash: sha256(String(stdout ?? "")), stderrHash: sha256(String(stderr ?? "")) })).digest("hex");
export const readHookInput = async () => { let raw = ""; for await (const chunk of process.stdin) raw += chunk; try { return JSON.parse(raw || "{}"); } catch { throw new Error("HOOK_INPUT_INVALID"); } };
export { dirtyFingerprint, repositoryIdentity, root, sha256 };
