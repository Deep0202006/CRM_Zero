import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { dirtyFingerprint, git, repositoryIdentity, root, sha256 } from "../kernel-lib.mjs";

const Status = z.enum(["SCOPE_UNRESOLVED", "IMPLEMENTATION_IN_PROGRESS", "LOCAL_PROOFS_REQUIRED", "PR_REQUIRED", "REMOTE_PENDING", "REMOTE_FAILED", "EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT", "READY_TO_END", "STALL_LIMIT"]);
const State = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  status: Status,
  taskId: z.string().optional(),
  taskHash: z.string().optional(),
  taskSequence: z.number().int().nonnegative().default(0),
  scopeRevision: z.number().int().nonnegative().default(0),
  baseline: z.object({ headSha: z.string(), treeSha: z.string(), baseSha: z.string(), dirtyFingerprint: z.string() }).optional(),
  repository: z.object({ headSha: z.string(), treeSha: z.string(), baseSha: z.string(), dirtyFingerprint: z.string() }).optional(),
  resolution: z.unknown().optional(),
  evidence: z.array(z.unknown()).default([]),
  failureSignatures: z.array(z.string()).default([]),
  stallCount: z.number().int().nonnegative().default(0),
  progressSignature: z.string().optional(),
}).strict();

const safeId = (value) => String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
export const sessionsDirectory = () => resolve(root, git("rev-parse", "--git-path", "zd-kernel/sessions"));
export const sessionPath = (sessionId) => resolve(sessionsDirectory(), `${safeId(sessionId)}.json`);
const initial = (sessionId) => State.parse({ schemaVersion: 1, sessionId: safeId(sessionId), revision: 0, status: "SCOPE_UNRESOLVED", taskSequence: 0, evidence: [], failureSignatures: [], stallCount: 0 });

const preserveCorrupt = (path, raw) => {
  const preserved = `${path}.corrupt-${Date.now()}-${sha256(raw).slice(0, 12)}`;
  renameSync(path, preserved);
  throw new Error(`STATE_CORRUPT_PRESERVED:${preserved}`);
};
export const loadState = (sessionId) => {
  const path = sessionPath(sessionId);
  if (!existsSync(path)) return initial(sessionId);
  const raw = readFileSync(path, "utf8");
  try { return State.parse(JSON.parse(raw)); }
  catch { return preserveCorrupt(path, raw); }
};
const acquire = (path, retries = 40) => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try { return openSync(path, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new Error("STATE_LOCK_TIMEOUT");
};
export const compareAndSwap = (sessionId, expectedRevision, update) => {
  const path = sessionPath(sessionId), lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const handle = acquire(lock);
  try {
    const current = loadState(sessionId);
    if (current.revision !== expectedRevision) throw new Error(`STATE_STALE_WRITE:${expectedRevision}:${current.revision}`);
    const next = State.parse({ ...current, ...update, sessionId: current.sessionId, revision: current.revision + 1 });
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    const output = openSync(temp, "wx", 0o600);
    try { writeFileSync(output, `${JSON.stringify(next)}\n`); fsyncSync(output); }
    finally { closeSync(output); }
    renameSync(temp, path);
    return next;
  } finally {
    closeSync(handle);
    if (existsSync(lock)) unlinkSync(lock);
  }
};
export const updateState = (sessionId, transform) => {
  const current = loadState(sessionId);
  return compareAndSwap(sessionId, current.revision, transform(current));
};
export const beginExternalTask = (sessionId, prompt) => {
  const current = loadState(sessionId), baseline = repositoryIdentity();
  return compareAndSwap(sessionId, current.revision, {
    schemaVersion: 1,
    sessionId: current.sessionId,
    revision: current.revision,
    status: "SCOPE_UNRESOLVED",
    taskId: randomUUID(),
    taskHash: sha256(prompt),
    taskSequence: current.taskSequence + 1,
    scopeRevision: 0,
    baseline,
    resolution: undefined,
    evidence: [],
    failureSignatures: [],
    stallCount: 0,
    progressSignature: undefined,
  });
};
export const requireContinuation = (sessionId, taskId) => {
  const state = loadState(sessionId);
  if (!state.taskId || state.taskId !== taskId) throw new Error("CONTINUATION_TASK_MISMATCH");
  return state;
};
export const sanitizedFailureSignature = ({ tool, input, exitCode, stdout, stderr }) =>
  createHash("sha256").update(JSON.stringify({ tool, inputHash: sha256(JSON.stringify(input ?? {})), exitCode, stdoutHash: sha256(String(stdout ?? "")), stderrHash: sha256(String(stderr ?? "")) })).digest("hex");
export const readHookInput = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw || "{}"); }
  catch { throw new Error("HOOK_INPUT_INVALID"); }
};
export { dirtyFingerprint, repositoryIdentity, root, sha256 };
