import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { buildSourceIndex } from "./source-index.mjs";
import { resolveContext } from "./context.mjs";
import { appendProgress, assertCompleteTaskDirectory, compareAndSwapTask, createTask, findActiveTask, loadTask, nextTaskId, taskDirectory, updateTaskState, writeTaskArtifact } from "./task-state.mjs";
import { git, gitEnvironmentFor, parseArgs, root, sha256 } from "./kernel-lib.mjs";
import { makeEngineeringTemp, removeEngineeringTemp } from "./managed-paths.mjs";
import { initializeTaskExperience } from "./experience.mjs";

const identity = () => ({ branch: git("branch", "--show-current"), worktree: git("rev-parse", "--show-toplevel"), baseSha: git("rev-parse", "origin/main"), headSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}") });
const gitAt = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnvironmentFor(cwd), maxBuffer: 64 << 20 }).trim();
const branchKind = (task) => /\b(cleanup|containment|config|configuration|kernel|tooling|maintenance)\b/i.test(task) ? "chore" : /\b(fix|bug|repair|correct|broken|error|failure)\b/i.test(task) ? "fix" : "feat";
const branchSlug = (task) => String(task).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42).replace(/-$/g, "") || "owner-task";
export const managedTaskIdentity = (task, attempt = 0) => {
  const suffix = sha256(`${task}\0${attempt}`).slice(0, 8), slug = branchSlug(task);
  return { branch: `${branchKind(task)}/${slug}-${suffix}`, directory: `${slug}-${suffix}` };
};
export const provisionTaskWorkspace = (task, from = root) => {
  const common = gitAt(from, "rev-parse", "--path-format=absolute", "--git-common-dir"), repository = dirname(common), worktrees = resolve(repository, ".worktrees");
  gitAt(repository, "fetch", "origin", "main"); mkdirSync(worktrees, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = managedTaskIdentity(task, attempt), worktree = resolve(worktrees, candidate.directory);
    const branchExists = spawnSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${candidate.branch}`], { cwd: repository, env: gitEnvironmentFor(repository) }).status === 0;
    if (branchExists || existsSync(worktree)) continue;
    gitAt(repository, "worktree", "add", "-b", candidate.branch, worktree, "origin/main");
    return { branch: candidate.branch, worktree, baseSha: gitAt(worktree, "rev-parse", "origin/main") };
  }
  throw new Error("TASK_WORKSPACE_COLLISION_LIMIT");
};
const currentWorkspaceIsSuitable = (task, current) => {
  const common = gitAt(current.worktree, "rev-parse", "--path-format=absolute", "--git-common-dir"), repository = dirname(common), child = relative(resolve(repository, ".worktrees"), current.worktree);
  const rootLocalFeature = /^(?:feat|fix|chore)\//.test(current.branch) && child && !child.startsWith("..") && !isAbsolute(child);
  const clean = !gitAt(current.worktree, "status", "--porcelain=v1", "--untracked-files=all"), active = findActiveTask({ branch: current.branch, worktree: current.worktree });
  return rootLocalFeature && clean && (!active || active.task === task);
};
export const createTaskInCurrentWorkspace = (task, { inspectOnly = false } = {}) => {
  const current = identity(), active = findActiveTask({ branch: current.branch, worktree: current.worktree }); if (active?.task === task) return { task: active, context: JSON.parse(readFileSync(resolve(taskDirectory(active.taskId), "context.json"), "utf8")), directory: taskDirectory(active.taskId), reused: true }; if (!currentWorkspaceIsSuitable(task, current)) throw new Error("NEW_TASK_WORKSPACE_UNSUITABLE");
  const index = buildSourceIndex(), context = resolveContext({ task, index }), taskId = nextTaskId(task, current.branch); createTask({ taskId, task, inspectOnly, identity: current, context: { schemaVersion: 1, index: { headSha: index.headSha, treeSha: index.treeSha, dirtyFingerprint: index.dirtyFingerprint }, ...context } });
  initializeTaskExperience({ taskId, task, context, identity: current }); appendProgress(taskId, { event: "CONTEXT_RESOLVED", status: context.status, candidateCount: context.candidatePaths.length, graphifyQueries: context.graphifyEvidence?.status === "GRAPHIFY_QUERIED" ? 1 : 0 }); return { task: loadTask(taskId), context, directory: taskDirectory(taskId) };
};
const compact = (taskId) => { const task = loadTask(taskId), context = JSON.parse(readFileSync(resolve(taskDirectory(taskId), "context.json"), "utf8")); return { task, context: { status: context.status, domains: context.domains, risk: context.risk, authorities: context.authorities, capabilities: context.capabilities, candidatePaths: context.candidatePaths?.map(({ path, contentHash, matchedBy }) => ({ path, contentHash, matchedBy })) }, directory: taskDirectory(taskId), resume: `npm run crm:task -- --resume ${taskId}` }; };
const selfTest = () => {
  const temporary = makeEngineeringTemp("t"), repositoryFixture = makeEngineeringTemp("r"), originFixture = makeEngineeringTemp("o"), previous = process.env.ZD_OS_STATE_ROOT; process.env.ZD_OS_STATE_ROOT = temporary;
  try {
    const taskId = "20260831-selftest", fixtureIdentity = { branch: "feat/fixture", worktree: "fixture", baseSha: "a".repeat(40), headSha: "b".repeat(40), treeSha: "c".repeat(40) }, context = { schemaVersion: 1, status: "RESOLVED", risk: "R1", authorities: [], capabilities: [], candidatePaths: [], requiredProofRefs: [] };
    const first = createTask({ taskId, task: "fixture engineering requirement", identity: fixtureIdentity, context }); assert.equal(first.revision, 0); assertCompleteTaskDirectory(taskId); const next = compareAndSwapTask(taskId, 0, { status: "INVESTIGATION_COMPLETE" }); assert.equal(next.revision, 1); assert.throws(() => compareAndSwapTask(taskId, 0, {}), /TASK_STALE_WRITE/); appendProgress(taskId, { event: "FOCUSED_PROOF", proofId: "fixture" }); appendProgress(taskId, { event: "TASK_RESUMED_WITH_HEAD_CHANGE" }); assert.equal(readFileSync(resolve(taskDirectory(taskId), "progress.jsonl"), "utf8").trim().split("\n").length, 3); assert.throws(() => writeTaskArtifact(taskId, "context.json", { token: "forbidden" }), /SENSITIVE/);
    gitAt(repositoryFixture, "init", "-q", "-b", "main"); gitAt(repositoryFixture, "config", "core.longpaths", "true"); gitAt(repositoryFixture, "config", "user.name", "CRM Fixture"); gitAt(repositoryFixture, "config", "user.email", "fixture@example.invalid"); writeFileSync(resolve(repositoryFixture, "tracked.txt"), "clean\n"); writeFileSync(resolve(repositoryFixture, ".gitignore"), ".worktrees/\n"); gitAt(repositoryFixture, "add", "tracked.txt", ".gitignore"); gitAt(repositoryFixture, "commit", "-q", "-m", "base"); gitAt(originFixture, "init", "-q", "--bare"); gitAt(originFixture, "config", "core.longpaths", "true"); gitAt(repositoryFixture, "remote", "add", "origin", originFixture); gitAt(repositoryFixture, "push", "-q", "-u", "origin", "main");
    writeFileSync(resolve(repositoryFixture, "tracked.txt"), "owner dirty work\n"); const dirtyBefore = gitAt(repositoryFixture, "status", "--porcelain=v1", "--untracked-files=all"), managed = provisionTaskWorkspace("Fix filter requirement", repositoryFixture);
    assert.equal(gitAt(repositoryFixture, "status", "--porcelain=v1", "--untracked-files=all"), dirtyBefore); assert.match(managed.branch, /^fix\//); assert.equal(relative(repositoryFixture, managed.worktree).replaceAll("\\", "/").startsWith(".worktrees/"), true); assert.equal(gitAt(managed.worktree, "branch", "--show-current"), managed.branch);
    return { code: "CRM_TASK_SELF_TEST_PASS", isolatedRoot: temporary, revision: next.revision, managedWorktree: managed.worktree, files: assertCompleteTaskDirectory(taskId).files };
  } finally { if (previous === undefined) delete process.env.ZD_OS_STATE_ROOT; else process.env.ZD_OS_STATE_ROOT = previous; removeEngineeringTemp(temporary); removeEngineeringTemp(repositoryFixture); removeEngineeringTemp(originFixture); }
};
export const runTaskController = () => {
  const args = parseArgs(); if (args.has("--self-test")) return selfTest();
  const prepareId = args.value("--prepare"); if (prepareId) {
    const task = loadTask(prepareId), directory = taskDirectory(prepareId), context = JSON.parse(readFileSync(resolve(directory, "context.json"), "utf8")), previousAcceptance = JSON.parse(readFileSync(resolve(directory, "acceptance.json"), "utf8")), previousProof = JSON.parse(readFileSync(resolve(directory, "proof.json"), "utf8")), previousDelivery = JSON.parse(readFileSync(resolve(directory, "delivery.json"), "utf8")), writeScope = String(args.value("--write", "")).split(",").map((value) => value.trim().replaceAll("\\", "/")).filter(Boolean);
    if (!args.value("--outcome") || !args.value("--acceptance") || !args.value("--reproduction") || !args.value("--root-cause") || !writeScope.length) throw new Error("TASK_PREPARE_FIELDS_REQUIRED");
    const scoped = writeScope.map((path) => { const absolute = resolve(root, path); return { path, contentHash: existsSync(absolute) ? sha256(readFileSync(absolute)) : "ABSENT", reason: "ROOT_CAUSE_OR_DETERMINISTIC_RELATIONSHIP" }; });
    const requested = args.value("--acceptance").split(";").map((text) => text.trim()).filter(Boolean), byText = new Map((previousAcceptance.items ?? []).map((item) => [item.text, item])), nextId = Math.max(0, ...(previousAcceptance.items ?? []).map((item) => Number(item.id) || 0)) + 1;
    const additions = requested.filter((text) => !byText.has(text)).map((text, index) => ({ id: nextId + index, text, status: "PENDING" })), nonGoals = [...new Set([...(previousAcceptance.nonGoals ?? []), ...String(args.value("--non-goals", "")).split(";").map((value) => value.trim()).filter(Boolean)])];
    const nextRevision = task.revision + 1, previousRuns = [...(previousProof.focusedRuns ?? []), ...(previousProof.broadRuns ?? [])], invalidatedProofIds = [...new Set([...(previousProof.invalidatedProofIds ?? []), ...previousRuns.map((run) => run.proofId ?? run.id).filter(Boolean)])];
    updateTaskState(prepareId, task.revision, { taskPatch: { status: "IMPLEMENTATION_READY", requirementsRevision: nextRevision }, artifacts: {
      "acceptance.json": { ...previousAcceptance, schemaVersion: 1, revision: task.revision + 1, observableOutcome: args.value("--outcome"), items: [...(previousAcceptance.items ?? []), ...additions], nonGoals },
      "plan.json": { schemaVersion: 1, revision: task.revision + 1, reproduction: args.value("--reproduction"), rootCause: args.value("--root-cause"), affectedAuthority: context.authorities ?? [], capabilitiesReused: context.capabilities ?? [], writeScope: scoped, protectedPaths: ["src/**", "public/**", "supabase/**", ".env*", "middleware.*", "proxy.*", "next.config.*", "vercel.json"], risk: context.risk, focusedProof: String(args.value("--proof", "")).split(",").filter(Boolean), amendments: previousAcceptance.items?.filter((item) => item.amendmentSequence).map((item) => ({ sequence: item.amendmentSequence, requirementHash: item.requirementHash, acceptanceId: item.id })) ?? [], preparationRequired: false },
      "proof.json": { ...previousProof, revision: nextRevision, requirementsRevision: nextRevision, focusedRuns: [], broadRuns: [], historicalRuns: [...(previousProof.historicalRuns ?? []), ...previousRuns.map((run) => ({ ...run, invalidatedByPreparationRevision: nextRevision }))], invalidatedProofIds, proofsInvalidated: (previousProof.proofsInvalidated ?? 0) + (previousRuns.length ? 1 : 0) },
      "delivery.json": { schemaVersion: 1, revision: nextRevision, status: "NOT_PUBLISHED", invalidatedByPreparationRevision: nextRevision, previous: { status: previousDelivery.status, pr: previousDelivery.pr ?? null, head: previousDelivery.head ?? null } },
    }, progress: [{ event: "INVESTIGATION_PERSISTED", writeScope: scoped.map((item) => item.path), rootCauseHash: sha256(args.value("--root-cause")) }] }); return compact(prepareId);
  }
  const statusId = args.value("--status"), resumeId = args.value("--resume"); if (statusId || resumeId) { const id = statusId || resumeId, current = identity(); let pack = compact(id); if (pack.task.branch !== current.branch || pack.task.worktree.replaceAll("\\", "/") !== current.worktree.replaceAll("\\", "/")) throw new Error("TASK_BRANCH_WORKTREE_MISMATCH"); if (resumeId) { if (pack.task.headSha !== current.headSha || pack.task.treeSha !== current.treeSha) { const proof = JSON.parse(readFileSync(resolve(taskDirectory(id), "proof.json"), "utf8")); updateTaskState(id, pack.task.revision, { taskPatch: { headSha: current.headSha, treeSha: current.treeSha, status: "LOCAL_PROOFS_REQUIRED" }, artifacts: { "proof.json": { ...proof, revision: pack.task.revision + 1, focusedRuns: [], broadRuns: [], invalidatedProofIds: [...new Set([...(proof.invalidatedProofIds ?? []), ...(proof.focusedRuns ?? []).map((run) => run.proofId).filter(Boolean)])], proofsInvalidated: (proof.proofsInvalidated ?? 0) + 1 } }, progress: [{ event: "TASK_RESUMED_WITH_HEAD_CHANGE" }] }); } else appendProgress(id, { event: "TASK_RESUMED" }); pack = compact(id); } return pack; }
  const task = args.value("--task"); if (!task || task.length < 8 || task.length > 2000) throw new Error("TASK_REQUIREMENT_INVALID");
  const current = identity();
  if (!args.has("--managed-adopt") && !currentWorkspaceIsSuitable(task, current)) {
    const managed = provisionTaskWorkspace(task, current.worktree), controller = resolve(managed.worktree, "scripts/engineering/task-controller.mjs"), child = spawnSync(process.execPath, [controller, ...process.argv.slice(2), "--managed-adopt"], { cwd: managed.worktree, encoding: "utf8", env: process.env, shell: false });
    if (child.status !== 0) throw new Error(`TASK_WORKSPACE_ADOPTION_FAILED:${child.stderr.trim()}`);
    return { ...JSON.parse(child.stdout), managedWorkspace: managed };
  }
  const created = createTaskInCurrentWorkspace(task, { inspectOnly: args.has("--inspect-only") }); return { ...created, next: created.context.status === "RESOLVED" ? "Inspect candidates and persist acceptance/root cause/write scope before editing." : "Read-only investigation only." };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) { try { console.log(JSON.stringify(runTaskController(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 2; } }
