import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { git, root, sha256 } from "./kernel-lib.mjs";

const requiredFiles = ["task.json", "acceptance.json", "context.json", "plan.json", "progress.jsonl", "proof.json", "delivery.json", "snapshot.json", "handoff.md"];
const generatedFiles = new Set(["task.json", "progress.jsonl", "snapshot.json", "handoff.md"]);
const secretKeyPattern = /"(?:password|secret|token|api[_-]?key|authorization|cookie)"\s*:/i;
const credentialPattern = /(?:sk|gh[oparsu])_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/;
const terminalStatuses = new Set(["COMPLETE", "RELEASE_COMPLETE"]);
const stateRoot = () => process.env.ZD_OS_STATE_ROOT || resolve(root, git("rev-parse", "--git-path", "zd-os/tasks"));
export const taskDirectory = (taskId) => { if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(taskId)) throw new Error("TASK_ID_INVALID"); return resolve(stateRoot(), taskId); };
const atomicWrite = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`; writeFileSync(temporary, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); renameSync(temporary, path); };
const bounded = (value) => { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 256 * 1024) throw new Error("TASK_STATE_TOO_LARGE"); if (secretKeyPattern.test(text) || credentialPattern.test(text)) throw new Error("TASK_STATE_SENSITIVE_DATA"); return value; };
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
const withLock = (directory, work) => {
  mkdirSync(directory, { recursive: true }); const lockPath = resolve(directory, ".lock"), deadline = Date.now() + 2_000, token = randomUUID(); let descriptor, delay = 5;
  while (descriptor === undefined) {
    try { descriptor = openSync(lockPath, "wx", 0o600); try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), token })); } catch (error) { closeSync(descriptor); descriptor = undefined; rmSync(lockPath, { force: true }); throw error; } }
    catch (error) { if (error.code !== "EEXIST" || Date.now() >= deadline) throw new Error("TASK_LOCK_TIMEOUT"); removeStaleLock(lockPath); wait(delay); delay = Math.min(delay * 2, 80); }
  }
  try { return work(); } finally {
    closeSync(descriptor);
    try { if (JSON.parse(readFileSync(lockPath, "utf8")).token === token) rmSync(lockPath, { force: true }); } catch {}
  }
};
const readJson = (path) => {
  const raw = readFileSync(path, "utf8");
  try { return JSON.parse(raw); } catch { throw new Error(`TASK_STATE_CORRUPT:${basename(path)}:${sha256(raw).slice(0, 12)}`); }
};
const readRecord = (taskId) => { const record = readJson(resolve(taskDirectory(taskId), "task.json")); if (record.schemaVersion !== 1 || record.taskId !== taskId || !Number.isInteger(record.revision)) throw new Error(`TASK_STATE_CORRUPT:task.json:${sha256(JSON.stringify(record)).slice(0, 12)}`); return record; };
const readProgress = (directory) => {
  const raw = readFileSync(resolve(directory, "progress.jsonl"), "utf8");
  try { return raw.trim().split("\n").filter(Boolean).map((row) => JSON.parse(row)); } catch { throw new Error(`TASK_STATE_CORRUPT:progress.jsonl:${sha256(raw).slice(0, 12)}`); }
};
const deliverySummary = (delivery) => ({ status: delivery.status, pr: delivery.pr ?? null, head: delivery.head ?? null, base: delivery.base ?? null, preview: delivery.preview ? { id: delivery.preview.id, head: delivery.preview.head, state: delivery.preview.state ?? "READY" } : null });
const proofSummary = (proof) => {
  const runs = [...(proof.focusedRuns ?? []), ...(proof.broadRuns ?? [])].map((run) => ({ proofId: run.proofId ?? run.id, status: run.status, head: run.head ?? run.headSha ?? null, taskRevision: run.taskRevision ?? null }));
  const latest = new Map(); for (const run of runs) if (run.proofId) latest.set(run.proofId, run);
  return { runs, failedOrInvalidated: [...new Set([[...latest.values()].filter((run) => !["PASS", "REUSED"].includes(run.status)).map((run) => run.proofId), proof.invalidatedProofIds ?? []].flat())], proofsInvalidated: proof.proofsInvalidated ?? 0, revision: proof.revision ?? null };
};
const nextAction = ({ task, acceptance, delivery, proof }) => {
  if (task.status === "INVESTIGATION_REQUIRED") return "Investigate the latest durable amendment, then prepare exact acceptance and write scope.";
  const blocked = acceptance.items?.find((item) => item.status === "BLOCKED"); if (blocked) return `Resolve blocked acceptance ${blocked.id}.`;
  const pending = acceptance.items?.find((item) => item.status !== "PASS"); if (pending) return `Prove acceptance ${pending.id}: ${pending.text}`;
  if (proof.failedOrInvalidated.length) return `Run invalidated proof ${proof.failedOrInvalidated[0]}.`;
  if (task.status === "IMPLEMENTATION_READY") return "Implement only within the exact write scope, then run the focused proof plan.";
  if (delivery.status === "OWNER_MIGRATION_REQUIRED") return "Wait for the exact Owner migration gate; do not execute production SQL.";
  if (delivery.status === "READY_FOR_RELEASE_APPROVAL") return "Wait for exact Owner release approval.";
  return "Resume the durable task and follow the current proof plan.";
};
const buildTaskSnapshot = (taskId) => {
  const directory = taskDirectory(taskId), task = readRecord(taskId), acceptance = readJson(resolve(directory, "acceptance.json")), context = readJson(resolve(directory, "context.json")), plan = readJson(resolve(directory, "plan.json")), progress = readProgress(directory), proofFile = readJson(resolve(directory, "proof.json")), deliveryFile = readJson(resolve(directory, "delivery.json"));
  const amendments = progress.filter((row) => row.event === "TASK_AMENDED").map((row) => ({ sequence: row.amendmentSequence ?? row.sequence, progressSequence: row.sequence, at: row.at, requirementHash: row.requirementHash, requirementBytes: row.requirementBytes, pointer: `${resolve(directory, "progress.jsonl")}#sequence=${row.sequence}` }));
  const proof = proofSummary(proofFile), blockers = [...(acceptance.items ?? []).filter((item) => item.status === "BLOCKED").map((item) => ({ type: "ACCEPTANCE", id: item.id, reasonHash: sha256(item.text ?? "") })), ...proof.failedOrInvalidated.map((proofId) => ({ type: "PROOF", proofId }))], recentFailures = progress.filter((row) => /FAIL|INVALIDAT|CONFLICT/.test(row.event ?? "")).slice(-5).map(({ event, at, proofId, reason, signature }) => ({ event, at, proofId, reason, signature })), snapshot = {
    schemaVersion: 2, taskId, objective: task.task, status: task.status, revision: task.revision,
    repository: { branch: task.branch, worktree: task.worktree, base: task.baseSha, head: task.headSha, tree: task.treeSha },
    acceptance: acceptance.items ?? [], nonGoals: acceptance.nonGoals ?? [], authorities: plan.affectedAuthority ?? context.authorities ?? [], writeScope: plan.writeScope ?? [], protectedPaths: plan.protectedPaths ?? [], risk: plan.risk ?? context.risk,
    blockers, recentFailures, amendments, proof, delivery: deliverySummary(deliveryFile), progress: progress.slice(-10).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "requirement"))), resume: `npm run crm:task -- --resume ${taskId}`,
  };
  return { ...snapshot, nextAction: nextAction({ task, acceptance, delivery: deliveryFile, proof }) };
};
export const readTaskSnapshot = (taskId) => {
  const path = resolve(taskDirectory(taskId), "snapshot.json");
  if (!existsSync(path)) return buildTaskSnapshot(taskId);
  const snapshot = readJson(path); if (snapshot.taskId !== taskId || !Number.isInteger(snapshot.revision)) throw new Error(`TASK_STATE_CORRUPT:snapshot.json:${sha256(JSON.stringify(snapshot)).slice(0, 12)}`); return snapshot;
};
export const readAutomaticTaskContext = (taskId) => {
  const snapshot = readTaskSnapshot(taskId), acceptance = snapshot.acceptance ?? [];
  return { schemaVersion: 1, taskId, revision: snapshot.revision, status: snapshot.status, repository: { branch: snapshot.repository.branch, head: snapshot.repository.head, tree: snapshot.repository.tree }, risk: snapshot.risk, acceptance: { total: acceptance.length, pending: acceptance.filter((item) => item.status === "PENDING").length, blocked: acceptance.filter((item) => item.status === "BLOCKED").length }, amendments: snapshot.amendments.map(({ sequence, requirementHash }) => ({ sequence, requirementHash })), invalidatedProofIds: snapshot.proof.failedOrInvalidated, deliveryStatus: snapshot.delivery.status, nextActionCode: snapshot.status === "INVESTIGATION_REQUIRED" ? "PREPARE_AMENDMENT" : "FOLLOW_CURRENT_PLAN" };
};
export const taskContextPointer = (taskId) => {
  const snapshotPath = resolve(taskDirectory(taskId), "snapshot.json"), path = existsSync(snapshotPath) ? snapshotPath : resolve(taskDirectory(taskId), "handoff.md"), bytes = readFileSync(path);
  return { schemaVersion: 1, taskId, revision: readTaskSnapshot(taskId).revision, path, byteCount: bytes.byteLength, sha256: sha256(bytes) };
};
const cleanCell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
const renderSnapshotHandoff = (snapshot) => {
  const done = snapshot.acceptance.filter((item) => item.status === "PASS"), pending = snapshot.acceptance.filter((item) => item.status === "PENDING"), blocked = snapshot.acceptance.filter((item) => item.status === "BLOCKED");
  const list = (items) => items.length ? items.map((item) => `- ${item.id}: ${cleanCell(item.text)}`).join("\n") : "- None";
  const matrix = snapshot.acceptance.length ? snapshot.acceptance.map((item) => `| ${cleanCell(item.id)} | ${cleanCell(item.status)} | ${cleanCell(item.text)} | ${cleanCell(item.evidence ?? "")} |`).join("\n") : "| - | PENDING | Acceptance not prepared | |";
  const scope = snapshot.writeScope.length ? snapshot.writeScope.map((item) => `- ${item.path} @ ${item.contentHash}`).join("\n") : "- None";
  const proofs = snapshot.proof.runs.length ? snapshot.proof.runs.map((item) => `- ${item.proofId}: ${item.status} @ ${item.head ?? "unbound"}`).join("\n") : "- No proof receipts";
  const amendments = snapshot.amendments.length ? snapshot.amendments.map((item) => `- ${item.requirementHash} @ ${item.pointer}`).join("\n") : "- None";
  const failures = snapshot.recentFailures.length ? snapshot.recentFailures.map((item) => `- ${item.event}${item.proofId ? `: ${item.proofId}` : ""} @ ${item.at ?? "unknown"}`).join("\n") : "- None";
  return `# Durable task handoff\n\nObjective: ${snapshot.objective}\n\nTask: ${snapshot.taskId} (revision ${snapshot.revision}, ${snapshot.status})\nBranch: ${snapshot.repository.branch}\nWorktree: ${snapshot.repository.worktree}\nBase: ${snapshot.repository.base}\nHead: ${snapshot.repository.head}\n\n## Done\n${list(done)}\n\n## Pending\n${list(pending)}\n\n## Blocked\n${list(blocked)}\n\n## Recent failures\n${failures}\n\n## Amendments\n${amendments}\n\n## Acceptance\n\n| ID | State | Requirement | Evidence |\n|---|---|---|---|\n${matrix}\n\n## Write scope\n${scope}\n\n## Proof summary\n${proofs}\n\nDelivery: ${snapshot.delivery.status}${snapshot.delivery.pr ? ` (PR #${snapshot.delivery.pr})` : ""}\n\nNext legal action: ${snapshot.nextAction}\n\nResume: ${snapshot.resume}\n`;
};
export const renderTaskHandoff = (taskId) => renderSnapshotHandoff(readTaskSnapshot(taskId));
const regenerateViews = (taskId) => { const snapshot = bounded(buildTaskSnapshot(taskId)); atomicWrite(resolve(taskDirectory(taskId), "snapshot.json"), snapshot); atomicWrite(resolve(taskDirectory(taskId), "handoff.md"), renderSnapshotHandoff(snapshot)); return snapshot; };
const validateArtifacts = (artifacts) => { for (const name of Object.keys(artifacts)) if (!requiredFiles.includes(name) || generatedFiles.has(name)) throw new Error("TASK_ARTIFACT_INVALID"); };
const commitUnlocked = (taskId, current, { taskPatch = {}, artifacts = {}, progress = [] }) => {
  validateArtifacts(artifacts); const revision = current.revision + 1, now = new Date().toISOString(), next = bounded({ ...current, ...taskPatch, taskId, schemaVersion: 1, revision, updatedAt: now }), validatedArtifacts = Object.fromEntries(Object.entries(artifacts).map(([name, value]) => [name, bounded(value)])), previous = readProgress(taskDirectory(taskId)), rows = progress.map((event, index) => bounded({ sequence: previous.length + index + 1, at: now, revision, ...event }));
  for (const [name, value] of Object.entries(validatedArtifacts)) atomicWrite(resolve(taskDirectory(taskId), name), value);
  atomicWrite(resolve(taskDirectory(taskId), "task.json"), next); if (rows.length) appendFileSync(resolve(taskDirectory(taskId), "progress.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n"); regenerateViews(taskId); return { task: next, artifacts: validatedArtifacts, progress: rows };
};
export const updateTaskState = (taskId, expectedRevision, update) => withLock(taskDirectory(taskId), () => { const current = readRecord(taskId); if (current.revision !== expectedRevision) throw new Error(`TASK_STALE_WRITE:${expectedRevision}:${current.revision}`); return commitUnlocked(taskId, current, update); });

export const makeTaskId = (task, branch = git("branch", "--show-current"), attempt = 0) => `${new Date().toISOString().slice(0,10).replaceAll("-", "")}-${sha256(`${branch}\0${task}\0${attempt}`).slice(0,12)}`;
export const nextTaskId = (task, branch = git("branch", "--show-current")) => { for (let attempt = 0; attempt < 100; attempt += 1) { const taskId = makeTaskId(task, branch, attempt); if (!existsSync(taskDirectory(taskId))) return taskId; } throw new Error("TASK_ID_COLLISION_LIMIT"); };
export const createTask = ({ taskId, task, inspectOnly = false, identity, context }) => withLock(taskDirectory(taskId), () => {
  const directory = taskDirectory(taskId), taskPath = resolve(directory, "task.json"); if (existsSync(taskPath)) throw new Error("TASK_ALREADY_EXISTS");
  const now = new Date().toISOString(), record = bounded({ schemaVersion: 1, taskId, revision: 0, requirementsRevision: 0, task, inspectOnly, status: inspectOnly ? "INSPECTION_READY" : "INVESTIGATION_REQUIRED", branch: identity.branch, worktree: identity.worktree, baseSha: identity.baseSha, headSha: identity.headSha, treeSha: identity.treeSha, createdAt: now, updatedAt: now });
  atomicWrite(taskPath, record); atomicWrite(resolve(directory, "acceptance.json"), { schemaVersion: 1, revision: 0, items: [], nonGoals: [], observableOutcome: "PENDING_INVESTIGATION" }); atomicWrite(resolve(directory, "context.json"), bounded(context)); atomicWrite(resolve(directory, "plan.json"), { schemaVersion: 1, revision: 0, reproduction: "PENDING", rootCause: "PENDING", affectedAuthority: context.authorities ?? [], capabilitiesReused: context.capabilities ?? [], writeScope: [], protectedPaths: ["src/**", "public/**", "supabase/**", ".env*", "middleware.*", "proxy.*", "next.config.*", "vercel.json"], risk: context.risk, focusedProof: context.requiredProofRefs ?? [], amendments: [] });
  writeFileSync(resolve(directory, "progress.jsonl"), `${JSON.stringify({ sequence: 1, at: now, event: "TASK_CREATED", revision: 0 })}\n`, { flag: "wx" }); atomicWrite(resolve(directory, "proof.json"), { schemaVersion: 1, revision: 0, focusedRuns: [], broadRuns: [], historicalRuns: [], freshProofsReused: 0, proofsInvalidated: 0, invalidatedProofIds: [], avoidableReruns: 0 }); atomicWrite(resolve(directory, "delivery.json"), { schemaVersion: 1, revision: 0, status: "NOT_PUBLISHED" }); regenerateViews(taskId); return record;
});
export const loadTask = (taskId) => readRecord(taskId);
export const compareAndSwapTask = (taskId, expectedRevision, patch) => updateTaskState(taskId, expectedRevision, { taskPatch: patch }).task;
export const appendProgress = (taskId, event) => { const current = loadTask(taskId); return updateTaskState(taskId, current.revision, { progress: [event] }).progress[0]; };
export const amendTask = (taskId, expectedRevision, prompt) => withLock(taskDirectory(taskId), () => {
  const text = String(prompt ?? "").trim(); if (!text || Buffer.byteLength(text) > 8192) throw new Error("TASK_AMENDMENT_INVALID"); const current = readRecord(taskId); if (current.revision !== expectedRevision) throw new Error(`TASK_STALE_WRITE:${expectedRevision}:${current.revision}`);
  const directory = taskDirectory(taskId), acceptance = readJson(resolve(directory, "acceptance.json")), plan = readJson(resolve(directory, "plan.json")), proof = readJson(resolve(directory, "proof.json")), delivery = readJson(resolve(directory, "delivery.json")), progress = readProgress(directory), amendmentSequence = Math.max(0, ...progress.filter((row) => row.event === "TASK_AMENDED").map((row) => Number(row.amendmentSequence) || 0)) + 1, requirementHash = sha256(text), nextAcceptanceId = Math.max(0, ...(acceptance.items ?? []).map((item) => Number(item.id) || 0)) + 1;
  const previousRuns = [...(proof.focusedRuns ?? []), ...(proof.broadRuns ?? [])], invalidatedProofIds = [...new Set([...(proof.invalidatedProofIds ?? []), ...previousRuns.map((run) => run.proofId ?? run.id).filter(Boolean)])], nextRevision = current.revision + 1;
  const result = commitUnlocked(taskId, current, {
    taskPatch: { status: "INVESTIGATION_REQUIRED", requirementsRevision: nextRevision },
    artifacts: {
      "acceptance.json": { ...acceptance, revision: nextRevision, items: [...(acceptance.items ?? []), { id: nextAcceptanceId, text, status: "PENDING", amendmentSequence, requirementHash }] },
      "plan.json": { ...plan, revision: nextRevision, amendments: [...(plan.amendments ?? []), { sequence: amendmentSequence, requirementHash, acceptanceId: nextAcceptanceId }], preparationRequired: true },
      "proof.json": { ...proof, revision: nextRevision, requirementsRevision: nextRevision, focusedRuns: [], broadRuns: [], historicalRuns: [...(proof.historicalRuns ?? []), ...previousRuns.map((run) => ({ ...run, invalidatedByAmendment: amendmentSequence }))], invalidatedProofIds, proofsInvalidated: (proof.proofsInvalidated ?? 0) + 1 },
      "delivery.json": { schemaVersion: 1, revision: nextRevision, status: "NOT_PUBLISHED", invalidatedByAmendment: amendmentSequence, previous: { status: delivery.status, pr: delivery.pr ?? null, head: delivery.head ?? null } },
    },
    progress: [{ event: "TASK_AMENDED", amendmentSequence, requirementHash, requirementBytes: Buffer.byteLength(text), acceptanceId: nextAcceptanceId, invalidatedProofIds }],
  });
  return { task: result.task, amendment: result.progress[0] };
});
export const writeTaskArtifact = (taskId, name, value) => { const current = loadTask(taskId); return updateTaskState(taskId, current.revision, { artifacts: { [name]: value } }).artifacts[name]; };
export const synchronizeTaskHead = (taskId, identity) => { const current = loadTask(taskId); if (current.headSha === identity.headSha && current.treeSha === identity.treeSha) return current; return compareAndSwapTask(taskId, current.revision, { headSha: identity.headSha, treeSha: identity.treeSha, status: "LOCAL_PROOFS_REQUIRED" }); };
export const consumeTaskDeliveryPermit = (taskId, validate) => withLock(taskDirectory(taskId), () => { const current = readRecord(taskId), delivery = readJson(resolve(taskDirectory(taskId), "delivery.json")); validate(delivery); const consumed = bounded({ ...delivery, consumed: true, consumedAt: new Date().toISOString(), revision: current.revision + 1 }); commitUnlocked(taskId, current, { artifacts: { "delivery.json": consumed } }); return consumed; });
export const assertCompleteTaskDirectory = (taskId) => { const directory = taskDirectory(taskId), missing = requiredFiles.filter((name) => !existsSync(resolve(directory, name))); if (missing.length) throw new Error(`TASK_FILES_MISSING:${missing.join(",")}`); return { taskId, directory, files: requiredFiles }; };
export const isTaskTerminal = (taskId) => { const task = loadTask(taskId), delivery = readJson(resolve(taskDirectory(taskId), "delivery.json")); return terminalStatuses.has(task.status) || delivery.status === "RELEASE_COMPLETE"; };
const normalized = (value) => String(value).replaceAll("\\", "/");
export const listCompatibleTasks = ({ branch = git("branch", "--show-current"), worktree = git("rev-parse", "--show-toplevel"), unfinishedOnly = true } = {}) => {
  if (!existsSync(stateRoot())) return []; const tasks = [], corrupt = [];
  for (const entry of readdirSync(stateRoot(), { withFileTypes: true }).filter((item) => item.isDirectory())) {
    try { const task = loadTask(entry.name), unfinished = !isTaskTerminal(task.taskId); if (task.branch === branch && normalized(task.worktree) === normalized(worktree) && (!unfinishedOnly || unfinished)) tasks.push(task); }
    catch (error) { corrupt.push({ taskId: entry.name, error: error.message }); }
  }
  if (corrupt.length) throw new Error(`TASK_DISCOVERY_CORRUPT:${corrupt.length}:${sha256(JSON.stringify(corrupt)).slice(0, 12)}`);
  return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
export const findActiveTask = (options = {}) => listCompatibleTasks(options)[0] ?? null;
