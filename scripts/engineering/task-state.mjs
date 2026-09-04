import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { git, root, sha256 } from "./kernel-lib.mjs";

const requiredFiles = ["task.json", "acceptance.json", "context.json", "plan.json", "progress.jsonl", "proof.json", "delivery.json", "handoff.md"];
const generatedFiles = new Set(["task.json", "progress.jsonl", "handoff.md"]);
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
const readJson = (path, preserveCorrupt = false) => {
  const raw = readFileSync(path, "utf8");
  try { return JSON.parse(raw); }
  catch (error) { if (preserveCorrupt) renameSync(path, `${path}.corrupt-${Date.now()}`); throw new Error(`TASK_STATE_CORRUPT${preserveCorrupt ? "_PRESERVED" : ""}:${error.message}`); }
};
const readRecord = (taskId, preserveCorrupt = false) => { const record = readJson(resolve(taskDirectory(taskId), "task.json"), preserveCorrupt); if (record.schemaVersion !== 1 || record.taskId !== taskId || !Number.isInteger(record.revision)) throw new Error("TASK_SCHEMA_INVALID"); return record; };
const readProgress = (directory) => readFileSync(resolve(directory, "progress.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((row) => JSON.parse(row));
const deliverySummary = (delivery) => ({ status: delivery.status, pr: delivery.pr ?? null, head: delivery.head ?? null, base: delivery.base ?? null, preview: delivery.preview ? { id: delivery.preview.id, head: delivery.preview.head, state: delivery.preview.state ?? "READY" } : null });
const proofSummary = (proof) => {
  const runs = [...(proof.focusedRuns ?? []), ...(proof.broadRuns ?? [])].map((run) => ({ proofId: run.proofId ?? run.id, status: run.status, head: run.head ?? run.headSha ?? null }));
  const latest = new Map(); for (const run of runs) if (run.proofId) latest.set(run.proofId, run);
  return { runs, failedOrInvalidated: [...new Set([[...latest.values()].filter((run) => !["PASS", "REUSED"].includes(run.status)).map((run) => run.proofId), proof.invalidatedProofIds ?? []].flat())], proofsInvalidated: proof.proofsInvalidated ?? 0 };
};
const nextAction = ({ task, acceptance, blockers, delivery, proof }) => {
  if (delivery.status === "OWNER_MIGRATION_REQUIRED") return "Wait for the exact Owner migration gate; do not execute production SQL.";
  if (delivery.status === "READY_FOR_RELEASE_APPROVAL") return "Wait for exact Owner release approval.";
  if (task.status === "INVESTIGATION_REQUIRED") return "Investigate the latest durable amendment, then prepare exact acceptance and write scope.";
  const blocked = acceptance.items?.find((item) => item.status === "BLOCKED"); if (blocked) return `Resolve blocked acceptance ${blocked.id}.`;
  const pending = acceptance.items?.find((item) => item.status !== "PASS"); if (pending) return `Prove acceptance ${pending.id}: ${pending.text}`;
  if (proof.failedOrInvalidated.length) return `Run invalidated proof ${proof.failedOrInvalidated[0]}.`;
  if (task.status === "IMPLEMENTATION_READY") return "Implement only within the exact write scope, then run the focused proof plan.";
  return "Resume the durable task and follow the current proof plan.";
};

export const readTaskSnapshot = (taskId) => {
  const directory = taskDirectory(taskId), task = readRecord(taskId), acceptance = readJson(resolve(directory, "acceptance.json")), context = readJson(resolve(directory, "context.json")), plan = readJson(resolve(directory, "plan.json")), progress = readProgress(directory), proofFile = readJson(resolve(directory, "proof.json")), deliveryFile = readJson(resolve(directory, "delivery.json"));
  const amendments = progress.filter((row) => row.event === "TASK_AMENDED").map((row) => ({ sequence: row.sequence, at: row.at, requirementHash: row.requirementHash, pointer: `${resolve(directory, "progress.jsonl")}#sequence=${row.sequence}` }));
  const proof = proofSummary(proofFile), blockers = [...(acceptance.items ?? []).filter((item) => item.status === "BLOCKED").map((item) => ({ type: "ACCEPTANCE", id: item.id, reason: item.text })), ...proof.failedOrInvalidated.map((proofId) => ({ type: "PROOF", proofId }))], recentFailures = progress.filter((row) => /FAIL|INVALIDAT|CONFLICT/.test(row.event ?? "")).slice(-5).map(({ event, at, proofId, reason, signature }) => ({ event, at, proofId, reason, signature })), snapshot = {
    schemaVersion: 1, taskId, objective: task.task, status: task.status, revision: task.revision,
    repository: { branch: task.branch, worktree: task.worktree, base: task.baseSha, head: task.headSha, tree: task.treeSha },
    acceptance: acceptance.items ?? [], nonGoals: acceptance.nonGoals ?? [], authorities: plan.affectedAuthority ?? context.authorities ?? [], writeScope: plan.writeScope ?? [], protectedPaths: plan.protectedPaths ?? [], risk: plan.risk ?? context.risk,
    blockers, recentFailures, amendments, proof, delivery: deliverySummary(deliveryFile), progress: progress.slice(-10).map(({ requirement, ...row }) => row), resume: `npm run crm:task -- --resume ${taskId}`,
  };
  return { ...snapshot, nextAction: nextAction({ task, acceptance, blockers, delivery: deliveryFile, proof }) };
};
const cleanCell = (value) => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
export const renderTaskHandoff = (taskId) => {
  const snapshot = readTaskSnapshot(taskId), done = snapshot.acceptance.filter((item) => item.status === "PASS"), pending = snapshot.acceptance.filter((item) => item.status === "PENDING"), blocked = snapshot.acceptance.filter((item) => item.status === "BLOCKED");
  const list = (items) => items.length ? items.map((item) => `- ${item.id}: ${cleanCell(item.text)}`).join("\n") : "- None";
  const matrix = snapshot.acceptance.length ? snapshot.acceptance.map((item) => `| ${cleanCell(item.id)} | ${cleanCell(item.status)} | ${cleanCell(item.text)} | ${cleanCell(item.evidence ?? "")} |`).join("\n") : "| - | PENDING | Acceptance not prepared | |";
  const scope = snapshot.writeScope.length ? snapshot.writeScope.map((item) => `- ${item.path} @ ${item.contentHash}`).join("\n") : "- None";
  const proofs = snapshot.proof.runs.length ? snapshot.proof.runs.map((item) => `- ${item.proofId}: ${item.status} @ ${item.head ?? "unbound"}`).join("\n") : "- No proof receipts";
  const amendments = snapshot.amendments.length ? snapshot.amendments.map((item) => `- ${item.requirementHash} @ ${item.pointer}`).join("\n") : "- None";
  const failures = snapshot.recentFailures.length ? snapshot.recentFailures.map((item) => `- ${item.event}${item.proofId ? `: ${item.proofId}` : ""} @ ${item.at ?? "unknown"}`).join("\n") : "- None";
  return `# Durable task handoff\n\nObjective: ${snapshot.objective}\n\nTask: ${snapshot.taskId} (revision ${snapshot.revision}, ${snapshot.status})\nBranch: ${snapshot.repository.branch}\nWorktree: ${snapshot.repository.worktree}\nBase: ${snapshot.repository.base}\nHead: ${snapshot.repository.head}\n\n## Done\n${list(done)}\n\n## Pending\n${list(pending)}\n\n## Blocked\n${list(blocked)}\n\n## Recent failures\n${failures}\n\n## Amendments\n${amendments}\n\n## Acceptance\n\n| ID | State | Requirement | Evidence |\n|---|---|---|---|\n${matrix}\n\n## Write scope\n${scope}\n\n## Proof summary\n${proofs}\n\nDelivery: ${snapshot.delivery.status}${snapshot.delivery.pr ? ` (PR #${snapshot.delivery.pr})` : ""}\n\nNext legal action: ${snapshot.nextAction}\n\nResume: ${snapshot.resume}\n`;
};
const regenerateHandoff = (taskId) => atomicWrite(resolve(taskDirectory(taskId), "handoff.md"), renderTaskHandoff(taskId));
const appendProgressUnlocked = (taskId, event) => { const task = readRecord(taskId), path = resolve(taskDirectory(taskId), "progress.jsonl"), previous = readProgress(taskDirectory(taskId)), row = bounded({ sequence: previous.length + 1, at: new Date().toISOString(), revision: task.revision, ...event }); appendFileSync(path, `${JSON.stringify(row)}\n`); return row; };

export const makeTaskId = (task, branch = git("branch", "--show-current")) => `${new Date().toISOString().slice(0,10).replaceAll("-", "")}-${sha256(`${branch}\0${task}`).slice(0,12)}`;
export const createTask = ({ taskId, task, inspectOnly = false, identity, context }) => withLock(taskDirectory(taskId), () => {
  const directory = taskDirectory(taskId), taskPath = resolve(directory, "task.json"); if (existsSync(taskPath)) throw new Error("TASK_ALREADY_EXISTS");
  const now = new Date().toISOString(), record = bounded({ schemaVersion: 1, taskId, revision: 0, task, inspectOnly, status: inspectOnly ? "INSPECTION_READY" : "INVESTIGATION_REQUIRED", branch: identity.branch, worktree: identity.worktree, baseSha: identity.baseSha, headSha: identity.headSha, treeSha: identity.treeSha, createdAt: now, updatedAt: now });
  atomicWrite(taskPath, record); atomicWrite(resolve(directory, "acceptance.json"), { schemaVersion: 1, items: [], nonGoals: [], observableOutcome: "PENDING_INVESTIGATION" }); atomicWrite(resolve(directory, "context.json"), bounded(context)); atomicWrite(resolve(directory, "plan.json"), { schemaVersion: 1, reproduction: "PENDING", rootCause: "PENDING", affectedAuthority: context.authorities ?? [], capabilitiesReused: context.capabilities ?? [], writeScope: [], protectedPaths: ["src/**", "public/**", "supabase/**", ".env*", "middleware.*", "proxy.*", "next.config.*", "vercel.json"], risk: context.risk, focusedProof: context.requiredProofRefs ?? [] });
  writeFileSync(resolve(directory, "progress.jsonl"), `${JSON.stringify({ sequence: 1, at: now, event: "TASK_CREATED", revision: 0 })}\n`, { flag: "wx" }); atomicWrite(resolve(directory, "proof.json"), { schemaVersion: 1, focusedRuns: [], broadRuns: [], freshProofsReused: 0, proofsInvalidated: 0, avoidableReruns: 0 }); atomicWrite(resolve(directory, "delivery.json"), { schemaVersion: 1, status: "NOT_PUBLISHED" }); regenerateHandoff(taskId); return record;
});
export const loadTask = (taskId) => readRecord(taskId, true);
export const compareAndSwapTask = (taskId, expectedRevision, patch) => withLock(taskDirectory(taskId), () => { const current = loadTask(taskId); if (current.revision !== expectedRevision) throw new Error("TASK_STALE_WRITE"); const next = bounded({ ...current, ...patch, taskId, schemaVersion: 1, revision: current.revision + 1, updatedAt: new Date().toISOString() }); atomicWrite(resolve(taskDirectory(taskId), "task.json"), next); regenerateHandoff(taskId); return next; });
export const appendProgress = (taskId, event) => withLock(taskDirectory(taskId), () => { const row = appendProgressUnlocked(taskId, event); regenerateHandoff(taskId); return row; });
export const amendTask = (taskId, expectedRevision, prompt) => withLock(taskDirectory(taskId), () => {
  const text = String(prompt ?? "").trim(); if (!text || Buffer.byteLength(text) > 8192) throw new Error("TASK_AMENDMENT_INVALID"); const current = loadTask(taskId); if (current.revision !== expectedRevision) throw new Error("TASK_STALE_WRITE");
  const next = bounded({ ...current, status: "INVESTIGATION_REQUIRED", revision: current.revision + 1, updatedAt: new Date().toISOString() }); atomicWrite(resolve(taskDirectory(taskId), "task.json"), next); const row = appendProgressUnlocked(taskId, { event: "TASK_AMENDED", requirement: text, requirementHash: sha256(text) }); regenerateHandoff(taskId); return { task: next, amendment: row };
});
export const writeTaskArtifact = (taskId, name, value) => { if (!requiredFiles.includes(name) || generatedFiles.has(name)) throw new Error("TASK_ARTIFACT_INVALID"); return withLock(taskDirectory(taskId), () => { atomicWrite(resolve(taskDirectory(taskId), name), bounded(value)); regenerateHandoff(taskId); return value; }); };
export const synchronizeTaskHead = (taskId, identity) => { const current = loadTask(taskId); if (current.headSha === identity.headSha && current.treeSha === identity.treeSha) return current; return compareAndSwapTask(taskId, current.revision, { headSha: identity.headSha, treeSha: identity.treeSha, status: "LOCAL_PROOFS_REQUIRED" }); };
export const consumeTaskDeliveryPermit = (taskId, validate) => withLock(taskDirectory(taskId), () => { const path = resolve(taskDirectory(taskId), "delivery.json"), current = readJson(path); validate(current); const consumed = bounded({ ...current, consumed: true, consumedAt: new Date().toISOString() }); atomicWrite(path, consumed); regenerateHandoff(taskId); return consumed; });
export const assertCompleteTaskDirectory = (taskId) => { const directory = taskDirectory(taskId), missing = requiredFiles.filter((name) => !existsSync(resolve(directory, name))); if (missing.length) throw new Error(`TASK_FILES_MISSING:${missing.join(",")}`); return { taskId, directory, files: requiredFiles }; };
const normalized = (value) => String(value).replaceAll("\\", "/");
export const listCompatibleTasks = ({ branch = git("branch", "--show-current"), worktree = git("rev-parse", "--show-toplevel"), unfinishedOnly = true } = {}) => { if (!existsSync(stateRoot())) return []; return readdirSync(stateRoot(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => { try { const task = loadTask(entry.name), delivery = readJson(resolve(taskDirectory(task.taskId), "delivery.json")), unfinished = task.status !== "COMPLETE" && delivery.status !== "RELEASE_COMPLETE"; return task.branch === branch && normalized(task.worktree) === normalized(worktree) && (!unfinishedOnly || unfinished) ? [task] : []; } catch { return []; } }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); };
export const findActiveTask = (options = {}) => listCompatibleTasks(options)[0] ?? null;
