import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { git, root, sha256 } from "./kernel-lib.mjs";

const requiredFiles = ["task.json", "acceptance.json", "context.json", "plan.json", "progress.jsonl", "proof.json", "delivery.json", "handoff.md"];
const secretPattern = /"(?:password|secret|token|api[_-]?key|authorization|cookie)"\s*:/i;
const stateRoot = () => process.env.ZD_OS_STATE_ROOT || resolve(root, git("rev-parse", "--git-path", "zd-os/tasks"));
export const taskDirectory = (taskId) => { if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(taskId)) throw new Error("TASK_ID_INVALID"); return resolve(stateRoot(), taskId); };
const atomicWrite = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`; writeFileSync(temporary, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); renameSync(temporary, path); };
const bounded = (value) => { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 256 * 1024) throw new Error("TASK_STATE_TOO_LARGE"); if (secretPattern.test(text)) throw new Error("TASK_STATE_SENSITIVE_DATA"); return value; };
const withLock = (directory, work) => {
  mkdirSync(directory, { recursive: true }); const lock = resolve(directory, ".lock"), deadline = Date.now() + 750; let descriptor;
  while (descriptor === undefined) { try { descriptor = openSync(lock, "wx"); } catch (error) { if (error.code !== "EEXIST" || Date.now() >= deadline) throw new Error("TASK_LOCK_TIMEOUT"); } }
  try { return work(); } finally { closeSync(descriptor); rmSync(lock, { force: true }); }
};
const readJsonPreserved = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) { if (existsSync(path)) renameSync(path, `${path}.corrupt-${Date.now()}`); throw new Error(`TASK_STATE_CORRUPT_PRESERVED:${error.message}`); } };
export const makeTaskId = (task, branch = git("branch", "--show-current")) => `${new Date().toISOString().slice(0,10).replaceAll("-", "")}-${sha256(`${branch}\0${task}`).slice(0,12)}`;
export const createTask = ({ taskId, task, inspectOnly = false, identity, context }) => withLock(taskDirectory(taskId), () => {
  const directory = taskDirectory(taskId), taskPath = resolve(directory, "task.json"); if (existsSync(taskPath)) throw new Error("TASK_ALREADY_EXISTS");
  const now = new Date().toISOString(), record = bounded({ schemaVersion: 1, taskId, revision: 0, task, inspectOnly, status: inspectOnly ? "INSPECTION_READY" : "INVESTIGATION_REQUIRED", branch: identity.branch, worktree: identity.worktree, baseSha: identity.baseSha, headSha: identity.headSha, treeSha: identity.treeSha, createdAt: now, updatedAt: now });
  atomicWrite(taskPath, record); atomicWrite(resolve(directory, "acceptance.json"), { schemaVersion: 1, items: [], nonGoals: [], observableOutcome: "PENDING_INVESTIGATION" }); atomicWrite(resolve(directory, "context.json"), bounded(context)); atomicWrite(resolve(directory, "plan.json"), { schemaVersion: 1, reproduction: "PENDING", rootCause: "PENDING", affectedAuthority: context.authorities ?? [], capabilitiesReused: context.capabilities ?? [], writeScope: [], protectedPaths: ["src/**", "public/**", "supabase/**", ".env*", "middleware.*", "proxy.*", "next.config.*", "vercel.json"], risk: context.risk, focusedProof: context.requiredProofRefs ?? [] });
  writeFileSync(resolve(directory, "progress.jsonl"), `${JSON.stringify({ sequence: 1, at: now, event: "TASK_CREATED", revision: 0 })}\n`, { flag: "wx" }); atomicWrite(resolve(directory, "proof.json"), { schemaVersion: 1, focusedRuns: [], broadRuns: [], freshProofsReused: 0, proofsInvalidated: 0, avoidableReruns: 0 }); atomicWrite(resolve(directory, "delivery.json"), { schemaVersion: 1, status: "NOT_PUBLISHED" }); atomicWrite(resolve(directory, "handoff.md"), `# Task ${taskId}\n\nStatus: ${record.status}\n\nResume: npm run crm:task -- --resume ${taskId}\n`); return record;
});
export const loadTask = (taskId) => { const directory = taskDirectory(taskId), record = readJsonPreserved(resolve(directory, "task.json")); if (record.schemaVersion !== 1 || record.taskId !== taskId || !Number.isInteger(record.revision)) throw new Error("TASK_SCHEMA_INVALID"); return record; };
export const compareAndSwapTask = (taskId, expectedRevision, patch) => withLock(taskDirectory(taskId), () => { const current = loadTask(taskId); if (current.revision !== expectedRevision) throw new Error("TASK_STALE_WRITE"); const next = bounded({ ...current, ...patch, taskId, schemaVersion: 1, revision: current.revision + 1, updatedAt: new Date().toISOString() }); atomicWrite(resolve(taskDirectory(taskId), "task.json"), next); return next; });
export const appendProgress = (taskId, event) => withLock(taskDirectory(taskId), () => { const task = loadTask(taskId), path = resolve(taskDirectory(taskId), "progress.jsonl"), previous = readFileSync(path, "utf8").trim().split("\n").filter(Boolean), row = bounded({ sequence: previous.length + 1, at: new Date().toISOString(), revision: task.revision, ...event }); appendFileSync(path, `${JSON.stringify(row)}\n`); return row; });
export const writeTaskArtifact = (taskId, name, value) => { if (!requiredFiles.includes(name) || ["task.json", "progress.jsonl"].includes(name)) throw new Error("TASK_ARTIFACT_INVALID"); return withLock(taskDirectory(taskId), () => { atomicWrite(resolve(taskDirectory(taskId), name), name.endsWith(".md") ? String(value) : bounded(value)); return value; }); };
export const consumeTaskDeliveryPermit = (taskId, validate) => withLock(taskDirectory(taskId), () => {
  const path = resolve(taskDirectory(taskId), "delivery.json"), current = readJsonPreserved(path);
  validate(current);
  const consumed = bounded({ ...current, consumed: true, consumedAt: new Date().toISOString() });
  atomicWrite(path, consumed);
  return consumed;
});
export const assertCompleteTaskDirectory = (taskId) => { const directory = taskDirectory(taskId), missing = requiredFiles.filter((name) => !existsSync(resolve(directory, name))); if (missing.length) throw new Error(`TASK_FILES_MISSING:${missing.join(",")}`); return { taskId, directory, files: requiredFiles }; };
export const findActiveTask = ({ branch = git("branch", "--show-current"), worktree = git("rev-parse", "--show-toplevel") } = {}) => { if (!existsSync(stateRoot())) return null; const matches = readdirSync(stateRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => { try { const task = loadTask(entry.name); return task.branch === branch && task.worktree.replaceAll("\\", "/") === worktree.replaceAll("\\", "/") ? [task] : []; } catch { return []; } }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return matches[0] ?? null; };
