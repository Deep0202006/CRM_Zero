import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyCommand, CommandClass } from "./command-policy.mjs";
import { buildSourceIndex } from "./source-index.mjs";
import { compileImpact, parseNameStatus } from "./impact.mjs";
import { buildSqlFunctionCatalogue, deriveFunctionAuthorities, extractSourceOperations, extractSqlOperations, resolveWriteAuthorities } from "./authority-resolution.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import * as certifierModule from "./proof-certify-ci.mjs";
import { validateEvidenceFile } from "./proof-certify-ci.mjs";
import { parseVerifiedAttestation } from "./proof-attestation.mjs";
import { assertDisposablePostgresEnvironment, compileRegisteredCommandPlan, disposablePostgresEnvironment, proofDefinitionHash, proofRunnerIdentity } from "./proof-command-plan.mjs";
import { evidencePayloadHash } from "./proof-evidence.mjs";
import { canonicalEvidencePath, runRegisteredProof } from "./proof-runner.mjs";
import { executeRegressionCases, validateCaseResult } from "./regression-executors.mjs";
import { queryGraphify, resolveContext, revalidateCandidate } from "./context.mjs";
import { doctor } from "./kernel-doctor.mjs";
import { applyStallPolicy, evaluateStopState, protectedRequiredChecks, remoteGate, requiredRemoteChecks } from "./hooks/stop.mjs";
import { beginExternalTask, compareAndSwap, loadState, requireContinuation, sessionPath, sessionsDirectory } from "./hooks/state-store.mjs";
import { dirtyFingerprint, environmentPolicyHash, git, gitEnvironmentFor, gitNullConfig, inspectMigrationBoundaryTransition, parseMigrationNumber, repositoryIdentity, root, safeEnvironment, sha256, validateMigrationBoundaryTransition, validateMigrationLedger } from "./kernel-lib.mjs";
import { containsAssertionWeakening } from "../quality/assertion-policy.mjs";
import { inspectMigrationGate, runReleaseSelfTest, TARGETS, validateReleaseReceipt, waitForChecks, waitForGitDeployment } from "./release-controller.mjs";
import { assertManagedPath, engineeringTempRoot, makeEngineeringTemp, removeEngineeringTemp } from "./managed-paths.mjs";
import { releaseEnvironment } from "./release-entry.mjs";

const matrix = { state: [], risk: [], proof: [], attestation: [], commandPolicy: [], regression: [], stopRemote: [], stall: [], postgresEnvironment: [], tokenIsolation: [] }, tempRoots = [], createdEvidence = [], preservedEvidence = new Map();
const temp = (prefix) => { const path = makeEngineeringTemp(prefix); tempRoots.push(path); return path; };
const command = (cwd, file, args, env, input) => spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, input });
const gitAt = (cwd, ...args) => spawnSync("git", ["-c", "core.hooksPath=", ...args], { cwd, encoding: "utf8", env: gitEnvironmentFor(cwd) });
const snapshotDirectory = (directory) => {
  if (!existsSync(directory)) return { exists: false, files: [] };
  const files = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const path = resolve(current, name), stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else files.push({ path: relative(directory, path).replaceAll("\\", "/"), size: stat.size, sha256: sha256(readFileSync(path)) });
    }
  };
  visit(directory);
  return { exists: true, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
};
const restorePreservedEvidence = () => {
  for (const [path, contents] of preservedEvidence) if (contents === null) { if (existsSync(path)) unlinkSync(path); } else writeFileSync(path, contents);
  preservedEvidence.clear();
};
const restoreDirectoryExistence = (directory, snapshot) => {
  if (snapshot.exists || !existsSync(directory)) return;
  const prune = (current) => { for (const name of readdirSync(current)) { const path = resolve(current, name); if (statSync(path).isDirectory()) prune(path); } if (readdirSync(current).length === 0) rmdirSync(current); };
  prune(directory);
};
const withEnvironment = async (environment, work) => {
  const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  try { return await work(); }
  finally { for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
};
const expectClass = (commandText, expected, name) => {
  const actual = classifyCommand(commandText);
  assert.equal(actual.classification, expected, `${name}:${actual.reason}`);
  matrix.commandPolicy.push({ name, classification: actual.classification });
};
const attestationOutput = (environment, digest, mutate = () => {}) => {
  const workflow = `https://github.com/Deep0202006/CRM_Zero/.github/workflows/product-verification.yml@${environment.GITHUB_REF}`;
  const row = { verificationResult: {
    signature: { certificate: {
      issuer: "https://token.actions.githubusercontent.com", subjectAlternativeName: workflow, githubWorkflowTrigger: environment.GITHUB_EVENT_NAME,
      githubWorkflowSHA: environment.GITHUB_SHA, githubWorkflowRepository: environment.GITHUB_REPOSITORY, githubWorkflowRef: environment.GITHUB_REF,
      buildSignerURI: workflow, buildSignerDigest: environment.GITHUB_SHA, buildConfigURI: workflow, buildConfigDigest: environment.GITHUB_SHA,
      runnerEnvironment: "github-hosted", sourceRepositoryURI: "https://github.com/Deep0202006/CRM_Zero", sourceRepositoryOwnerURI: "https://github.com/Deep0202006",
      sourceRepositoryDigest: environment.GITHUB_SHA, sourceRepositoryRef: environment.GITHUB_REF,
      runInvocationURI: `https://github.com/Deep0202006/CRM_Zero/actions/runs/${environment.GITHUB_RUN_ID}/attempts/${environment.GITHUB_RUN_ATTEMPT}`,
    } },
    verifiedTimestamps: [{ type: "Tlog", uri: "https://rekor.sigstore.dev", timestamp: "2026-08-28T00:00:00Z" }],
    statement: { subject: [{ name: "proof.json", digest: { sha256: digest } }] },
  } };
  mutate(row);
  return JSON.stringify([row]);
};

const operationalDirectory = sessionsDirectory(), operationalBefore = snapshotDirectory(operationalDirectory), evidenceDirectory = resolve(root, "artifacts/engineering-evidence"), evidenceBefore = snapshotDirectory(evidenceDirectory);
const productBefore = snapshotDirectory(resolve(root, "src")), migrationsBefore = snapshotDirectory(resolve(root, "supabase/migrations"));
let isolatedGit = "", isolatedRemoved = false;
try {
  const releaseEnv = releaseEnvironment({});
  assert.equal(releaseEnv.TEMP, releaseEnv.TMP);
  assert.equal(releaseEnv.TEMP, releaseEnv.TMPDIR);
  assert.match(relative(root, releaseEnv.TEMP).replaceAll("\\", "/"), /^\.tmp\/engineering\/release$/);
  assert.throws(() => engineeringTempRoot("../outside"), /CRM_MANAGED_SCOPE_INVALID/);
  assert.throws(() => assertManagedPath(resolve(root, "outside")), /CRM_MANAGED_PATH_OUTSIDE_ROOT/);
  matrix.regression.push("release-cli-temp-root-local", "managed-temp-traversal-rejected");
  const emptyTree = temp("kernel-empty-tree-"); mkdirSync(resolve(emptyTree, "a/b"), { recursive: true }); restoreDirectoryExistence(emptyTree, { exists: false }); assert(!existsSync(emptyTree)); matrix.state.push("empty-evidence-tree-restored");
  const baseSha = git("rev-parse", "origin/main"), currentHead = git("rev-parse", "HEAD"), currentTree = git("rev-parse", "HEAD^{tree}");
  isolatedGit = temp("kernel-state-git-");
  assert.equal(command(root, "git", ["clone", "-q", "--bare", "--shared", root, isolatedGit]).status, 0);
  assert.equal(command(root, "git", ["--git-dir", isolatedGit, "config", "core.bare", "false"]).status, 0);
  assert.equal(command(root, "git", ["--git-dir", isolatedGit, "update-ref", "refs/remotes/origin/main", baseSha]).status, 0);
  assert.equal(command(root, "git", ["--git-dir", isolatedGit, "read-tree", "HEAD"]).status, 0);
  const isolatedEnvironment = { GIT_DIR: isolatedGit, GIT_WORK_TREE: root };
  await withEnvironment(isolatedEnvironment, async () => {
    assert.equal(repositoryIdentity().headSha, currentHead);
    const isolatedRegistry = command(root, process.execPath, ["scripts/engineering/registry-index.mjs"], isolatedEnvironment);
    assert.equal(isolatedRegistry.status, 0, isolatedRegistry.stderr); assert.match(isolatedRegistry.stdout, /"nodes":/); matrix.state.push("registry-index-disposable-git");
    const session = `kernel-test-${randomUUID()}`, first = beginExternalTask(session, "first external task");
    compareAndSwap(session, first.revision, { ...first, evidence: [{ proofId: "old" }], failureSignatures: ["old"], resolution: { status: "RESOLVED" }, progressSignature: "old" });
    const second = beginExternalTask(session, "second external task");
    assert.notEqual(second.taskId, first.taskId); assert.deepEqual(second.evidence, []); assert.deepEqual(second.failureSignatures, []); assert.equal(second.resolution, undefined); assert.equal(second.progressSignature, undefined);
    assert.equal(requireContinuation(session, second.taskId).taskId, second.taskId); assert.throws(() => requireContinuation(session, first.taskId), /CONTINUATION_TASK_MISMATCH/);
    const expandHook = command(root, process.execPath, ["scripts/engineering/hooks/user-prompt.mjs"], isolatedEnvironment, JSON.stringify({ session_id: session, prompt: `KERNEL_SCOPE_EXPAND|taskId=${second.taskId}|path=scripts/engineering/context.mjs|task=inspect exact context resolver` }));
    assert.equal(expandHook.status, 0); assert.equal(loadState(session).scopeRevision, 1); assert.equal(loadState(session).resolution.status, "RESOLVED");
    matrix.state.push("external-reset", "exact-continuation", "evidence-backed-scope-expansion");

    const staleSession = `kernel-test-${randomUUID()}`, stale = loadState(staleSession), stateModuleUrl = pathToFileURL(resolve(root, "scripts/engineering/hooks/state-store.mjs")).href;
    const code = `import {compareAndSwap} from ${JSON.stringify(stateModuleUrl)};try{compareAndSwap(process.argv[1],Number(process.argv[2]),{status:'IMPLEMENTATION_IN_PROGRESS'});process.exit(0)}catch(e){console.error(e.message);process.exit(2)}`;
    const children = [0, 1].map(() => new Promise((done) => { const child = spawn(process.execPath, ["--input-type=module", "-e", code, staleSession, String(stale.revision)], { cwd: root, env: { ...process.env, ...isolatedEnvironment }, stdio: ["ignore", "pipe", "pipe"] }); let stderr = ""; child.stderr.on("data", (chunk) => stderr += chunk); child.on("exit", (status) => done({ status, stderr })); }));
    const writes = await Promise.all(children);
    assert.deepEqual(writes.map((item) => item.status).sort(), [0, 2]); assert(writes.some((item) => item.stderr.includes("STATE_STALE_WRITE")));
    const lockSession = `kernel-test-${randomUUID()}`, lockPath = `${sessionPath(lockSession)}.lock`;
    mkdirSync(dirname(lockPath), { recursive: true }); writeFileSync(lockPath, "locked");
    assert.throws(() => compareAndSwap(lockSession, 0, { status: "IMPLEMENTATION_IN_PROGRESS" }), /STATE_LOCK_TIMEOUT/); unlinkSync(lockPath);
    matrix.state.push("concurrent-stale-rejected", "bounded-lock-timeout");

    const corruptSession = `kernel-test-${randomUUID()}`, corruptPath = sessionPath(corruptSession);
    mkdirSync(dirname(corruptPath), { recursive: true }); writeFileSync(corruptPath, "{interrupted");
    assert.throws(() => loadState(corruptSession), /STATE_CORRUPT_PRESERVED/); assert(readdirSync(dirname(corruptPath)).some((name) => name.startsWith(`${corruptSession}.json.corrupt-`)));
    const hookSession = `kernel-test-${randomUUID()}`;
    assert.equal(command(root, process.execPath, ["scripts/engineering/hooks/session-start.mjs"], isolatedEnvironment, JSON.stringify({ session_id: hookSession })).status, 0);
    assert.equal(command(root, process.execPath, ["scripts/engineering/hooks/post-tool.mjs"], isolatedEnvironment, JSON.stringify({ session_id: hookSession, tool_name: "fixture", tool_input: { command: "synthetic-private-input" }, tool_response: { exit_code: 9, stdout: "synthetic-private-output", stderr: "synthetic-private-error" } })).status, 0);
    const postState = loadState(hookSession), storedState = readFileSync(sessionPath(hookSession), "utf8");
    assert.equal(postState.failureSignatures[0].length, 64); assert(!storedState.includes("synthetic-private"));
    matrix.state.push("corrupt-preserved-fail-closed", "hook-schema-valid", "failure-output-hashed-only");

    const stallSession = `kernel-test-${randomUUID()}`, stopInvocation = () => command(root, process.execPath, ["scripts/engineering/hooks/stop.mjs"], isolatedEnvironment, JSON.stringify({ session_id: stallSession }));
    const firstStop = JSON.parse(stopInvocation().stdout), secondStop = JSON.parse(stopInvocation().stdout), thirdStop = JSON.parse(stopInvocation().stdout), fourthStop = JSON.parse(stopInvocation().stdout);
    assert.match(firstStop.reason, /strategy=FOCUSED_RETRY\|stallCount=1/); assert.match(secondStop.reason, /strategy=STRATEGY_CHANGE_REQUIRED\|stallCount=2/);
    assert.equal(thirdStop.stopReason, "STALL_LIMIT"); assert.equal(fourthStop.stopReason, "STALL_LIMIT"); assert.equal(loadState(stallSession).stallCount, 3);
    matrix.stall.push("stop-cli-third-stall-limit", "stop-cli-fourth-no-continuation");

    const runPreTool = (cmd) => command(root, process.execPath, ["scripts/engineering/hooks/pre-tool.mjs"], isolatedEnvironment, JSON.stringify({ session_id: `kernel-test-${randomUUID()}`, tool_name: "exec_command", tool_input: { cmd } }));
    for (const cmd of ["node -e require('fs').writeFileSync('x','y')", "python -c open('x','w')", "git apply patch.diff", "git checkout -- file", "git restore file", "git push origin HEAD:main", "git push origin feature/x --force", "git branch -D feature/x", "git remote set-url origin https://example.invalid/repo.git", "git worktree remove .worktrees/x", "git worktree prune", "supabase --project-ref X db push", "npx supabase db push", "npm exec -- vercel deploy", "printf fixture > file", "powershell -EncodedCommand ZgBpAHgAdAB1AHIAZQA="]) {
      const hook = runPreTool(cmd); assert.equal(hook.status, 0); assert.match(hook.stdout, /SAFETY_CONFLICT:COMMAND_POLICY/);
    }
    assert.match(runPreTool("git worktree add .worktrees/x chore/x").stdout, /SAFETY_CONFLICT:WORKTREE_SCOPE/);
    assert.equal(runPreTool("git status --short").stdout, ""); assert.equal(runPreTool("git push origin chore/engineering-kernel-v4").stdout, "");
    const scopedWorktree = command(root, process.execPath, ["scripts/engineering/hooks/pre-tool.mjs"], isolatedEnvironment, JSON.stringify({ session_id: session, tool_name: "exec_command", tool_input: { cmd: "git worktree add .worktrees/kernel-test-safe chore/kernel-test-safe" } }));
    assert.equal(scopedWorktree.stdout, "");
    matrix.risk.push("pretool-command-matrix-denied", "pretool-read-only-allowed", "pretool-feature-push-scoped", "pretool-worktree-add-requires-resolved-scope", "pretool-worktree-add-exact-resolved-scope");

    const identity = { schemaVersion: 1, baseSha, headSha: currentHead, treeSha: currentTree, dirtyFingerprint: dirtyFingerprint(), impactHash: "b".repeat(64), planHash: "a".repeat(64), requiredProofs: ["kernel-fixture-pass"], requiredByKind: { unit: ["kernel-fixture-pass"] }, notRequiredKinds: [] };
    const ciEnvironment = { CI: "true", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Deep0202006/CRM_Zero", GITHUB_WORKFLOW: "CRM Product Verification", GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: currentHead, GITHUB_REF: "refs/pull/89/merge", GITHUB_JOB: "preflight", GITHUB_EVENT_NAME: "pull_request", KERNEL_BASE_SHA: baseSha, KERNEL_HEAD_SHA: currentHead };
    const passPath = canonicalEvidencePath("kernel-fixture-pass"); assert(!existsSync(passPath), "fixture evidence already exists");
    const pass = await withEnvironment(ciEnvironment, () => runRegisteredProof({ proofId: "kernel-fixture-pass", plan: identity })); createdEvidence.push(passPath);
    assert.equal(pass.status, "PASS");
    validateEvidenceFile({ path: passPath, proofId: "kernel-fixture-pass", plan: identity, environment: ciEnvironment });
    const forgedRoot = temp("kernel-forged-evidence-");
    const rejectMutation = (name, mutate, pattern = /EVIDENCE|COMMAND|FLAKY|PROOF/) => {
      const forged = structuredClone(pass); mutate(forged); forged.evidencePayloadHash = evidencePayloadHash(forged);
      const path = resolve(forgedRoot, `${name}.json`); writeFileSync(path, JSON.stringify(forged));
      assert.throws(() => validateEvidenceFile({ path, proofId: "kernel-fixture-pass", plan: identity, environment: ciEnvironment }), pattern, name);
      matrix.proof.push(name);
    };
    rejectMutation("fabricated-pass", (item) => item.attempts[0].commands[0].commandIdentity = "0".repeat(64));
    rejectMutation("wrong-command", (item) => item.attempts[0].commands[0].args = ["forged"]);
    rejectMutation("wrong-order", (item) => item.attempts[0].commands.reverse());
    rejectMutation("missing-command", (item) => item.attempts[0].commands.pop());
    rejectMutation("extra-command", (item) => item.attempts[0].commands.push({ ...item.attempts[0].commands[0], commandIndex: 99 }));
    rejectMutation("wrong-proof-definition", (item) => item.proofDefinitionHash = "0".repeat(64));
    rejectMutation("wrong-command-plan", (item) => item.commandPlanHash = "0".repeat(64));
    rejectMutation("wrong-runner", (item) => item.runnerIdentity = "0".repeat(64));
    rejectMutation("wrong-repository", (item) => item.githubRepository = "Other/Repo");
    rejectMutation("wrong-run", (item) => item.githubRunId = "999");
    rejectMutation("wrong-job", (item) => item.githubJob = "unit-build");
    rejectMutation("wrong-head", (item) => item.headSha = "0".repeat(40));
    rejectMutation("wrong-base", (item) => item.baseSha = "0".repeat(40));
    rejectMutation("wrong-tree", (item) => item.treeSha = "0".repeat(40));
    rejectMutation("local-provenance", (item) => { item.provenanceMode = "LOCAL"; item.githubRepository = item.githubWorkflow = item.githubRunId = item.githubRunAttempt = item.githubJob = item.githubEvent = ""; });
    rejectMutation("reversed-time", (item) => { item.startedAt = "2026-01-02T00:00:00.000Z"; item.endedAt = "2026-01-01T00:00:00.000Z"; }, /TIMESTAMP/);
    rejectMutation("future-time", (item) => { item.startedAt = "2999-01-01T00:00:00.000Z"; item.endedAt = "2999-01-01T00:00:01.000Z"; }, /TIMESTAMP/);
    rejectMutation("nonzero-command", (item) => item.attempts[0].commands[0].exitCode = 1);
    rejectMutation("zero-output-arbitrary-digest", (item) => { item.attempts[0].commands[0].stdoutBytes = 0; item.attempts[0].commands[0].stdoutHash = "1".repeat(64); }, /OUTPUT/);
    rejectMutation("nonzero-output-empty-digest", (item) => { item.attempts[0].commands[0].stdoutBytes = 1; item.attempts[0].commands[0].stdoutHash = sha256(""); }, /OUTPUT/);
    rejectMutation("zero-output-zero-digest", (item) => { item.attempts[0].commands[0].stderrBytes = 0; item.attempts[0].commands[0].stderrHash = "0".repeat(64); }, /OUTPUT/);
    rejectMutation("unknown-field", (item) => item.callerAuthored = true, /unrecognized|Unrecognized|unknown/i);
    assert.equal(certifierModule.validateEvidenceItem, undefined, "in-memory evidence validator exposed");
    assert.equal(certifierModule.certifyRepositoryProof, undefined, "repository certificate API exposed");
    const selectedOutput = command(root, process.execPath, ["scripts/engineering/proof-runner.mjs", "--proof", "kernel-fixture-pass", "--output", resolve(forgedRoot, "caller.json")], isolatedEnvironment);
    assert.equal(selectedOutput.status, 2); assert.match(selectedOutput.stderr, /UNKNOWN_ARGUMENT:--output/); matrix.proof.push("caller-output-rejected", "direct-object-api-absent", "real-runner-evidence-accepted");

    const marker = resolve(root, git("rev-parse", "--git-path", "zd-kernel/fixtures/flaky-marker")); if (existsSync(marker)) unlinkSync(marker);
    const flakyPath = canonicalEvidencePath("kernel-fixture-flaky"); assert(!existsSync(flakyPath), "flaky fixture evidence already exists");
    const flakyPlan = { ...identity, requiredProofs: ["kernel-fixture-flaky"], requiredByKind: { unit: ["kernel-fixture-flaky"] } };
    const flaky = await withEnvironment(ciEnvironment, () => runRegisteredProof({ proofId: "kernel-fixture-flaky", plan: flakyPlan })); createdEvidence.push(flakyPath);
    assert.equal(flaky.status, "FLAKY_DETECTED"); assert.throws(() => validateEvidenceFile({ path: flakyPath, proofId: "kernel-fixture-flaky", plan: flakyPlan, environment: ciEnvironment }), /EVIDENCE_STALE|FLAKY/); matrix.proof.push("retry-pass-rejected");

    const subjectDigest = "d".repeat(64), verified = attestationOutput(ciEnvironment, subjectDigest);
    assert.equal(parseVerifiedAttestation({ output: verified, evidenceSha256: subjectDigest, environment: ciEnvironment }).repository, "Deep0202006/CRM_Zero");
    const rejectAttestation = (name, mutate, environment = ciEnvironment) => {
      assert.throws(() => parseVerifiedAttestation({ output: attestationOutput(ciEnvironment, subjectDigest, mutate), evidenceSha256: subjectDigest, environment }), /ATTESTATION/, name);
      matrix.attestation.push(name);
    };
    rejectAttestation("wrong-subject-digest", (row) => row.verificationResult.statement.subject[0].digest.sha256 = "0".repeat(64));
    rejectAttestation("wrong-signer-workflow", (row) => row.verificationResult.signature.certificate.buildSignerURI = "https://github.com/Other/Repo/.github/workflows/unsafe.yml@refs/heads/main");
    rejectAttestation("wrong-certificate-repository", (row) => row.verificationResult.signature.certificate.sourceRepositoryURI = "https://github.com/Other/Repo");
    rejectAttestation("wrong-run-attempt", (row) => row.verificationResult.signature.certificate.runInvocationURI = "https://github.com/Deep0202006/CRM_Zero/actions/runs/999/attempts/2");
    rejectAttestation("self-hosted-signer", (row) => row.verificationResult.signature.certificate.runnerEnvironment = "self-hosted");
    rejectAttestation("missing-verified-time", (row) => row.verificationResult.verifiedTimestamps = []);
    rejectAttestation("wrong-current-repository", () => {}, { ...ciEnvironment, GITHUB_REPOSITORY: "Other/Repo" });
    assert.throws(() => parseVerifiedAttestation({ output: "not-json", evidenceSha256: subjectDigest, environment: ciEnvironment }), /ATTESTATION/);
    matrix.attestation.push("valid-certificate-accepted", "fake-output-rejected");
  });
  for (const path of [...createdEvidence]) { if (existsSync(path)) unlinkSync(path); createdEvidence.splice(createdEvidence.indexOf(path), 1); }
  const attackPlan = compileProofPlan({ base: baseSha, head: currentHead }), proofRegistry = JSON.parse(readFileSync(resolve(root, "docs/engineering/PROOFS.json"), "utf8")).proofs;
  const attackEnvironment = { CI: "true", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Deep0202006/CRM_Zero", GITHUB_WORKFLOW: "CRM Product Verification", GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: currentHead, GITHUB_REF: "refs/pull/89/merge", GITHUB_EVENT_NAME: "pull_request", KERNEL_BASE_SHA: baseSha, KERNEL_HEAD_SHA: currentHead };
  for (const proofId of attackPlan.requiredProofs) {
    const proof = proofRegistry.find((item) => item.id === proofId), commandPlan = compileRegisteredCommandPlan({ proof, proofId, baseSha: attackPlan.baseSha, headSha: attackPlan.headSha }), now = new Date().toISOString();
    const commands = commandPlan.commands.map((commandItem) => ({ ...commandItem, exitCode: 0, stdoutHash: sha256(""), stdoutBytes: 0, stderrHash: sha256(""), stderrBytes: 0, startedAt: now, endedAt: now }));
    const evidence = { schemaVersion: 2, proofId, kind: proof.kind, status: "PASS", baseSha: attackPlan.baseSha, headSha: attackPlan.headSha, treeSha: attackPlan.treeSha, dirtyFingerprint: attackPlan.dirtyFingerprint, impactHash: attackPlan.impactHash, planHash: attackPlan.planHash, proofDefinitionHash: proofDefinitionHash(proof), runnerIdentity: proofRunnerIdentity(), commandPlanHash: commandPlan.commandPlanHash, environmentPolicyHash: environmentPolicyHash(), startedAt: now, endedAt: now, attempts: [{ attemptIndex: 1, commandPlanHash: commandPlan.commandPlanHash, startedAt: now, endedAt: now, commands }], provenanceMode: "GITHUB_ACTIONS", githubRepository: attackEnvironment.GITHUB_REPOSITORY, githubWorkflow: attackEnvironment.GITHUB_WORKFLOW, githubRunId: attackEnvironment.GITHUB_RUN_ID, githubRunAttempt: attackEnvironment.GITHUB_RUN_ATTEMPT, githubJob: commandPlan.expectedCiJob, githubEvent: attackEnvironment.GITHUB_EVENT_NAME, expectedSourceJob: commandPlan.expectedCiJob };
    evidence.evidencePayloadHash = evidencePayloadHash(evidence);
    const path = canonicalEvidencePath(proofId, commandPlan.expectedCiJob); mkdirSync(dirname(path), { recursive: true }); preservedEvidence.set(path, existsSync(path) ? readFileSync(path) : null); writeFileSync(path, JSON.stringify(evidence));
    validateEvidenceFile({ path, proofId, plan: attackPlan, environment: { ...attackEnvironment, GITHUB_JOB: commandPlan.expectedCiJob } });
  }
  const canonicalSet = certifierModule.requireCanonicalEvidenceFiles(attackPlan), firstProofId = attackPlan.requiredProofs[0], firstPath = canonicalSet.get(firstProofId), firstContents = readFileSync(firstPath);
  const wrongDirectory = resolve(dirname(dirname(firstPath)), "unit-build", `${firstProofId}.json`); mkdirSync(dirname(wrongDirectory), { recursive: true }); renameSync(firstPath, wrongDirectory); assert.throws(() => certifierModule.requireCanonicalEvidenceFiles(attackPlan), /EVIDENCE_FILE_SET_MISMATCH/); renameSync(wrongDirectory, firstPath);
  copyFileSync(firstPath, wrongDirectory); assert.throws(() => certifierModule.requireCanonicalEvidenceFiles(attackPlan), /EVIDENCE_FILE_SET_MISMATCH/); unlinkSync(wrongDirectory);
  unlinkSync(firstPath); assert.throws(() => certifierModule.requireCanonicalEvidenceFiles(attackPlan), /EVIDENCE_FILE_SET_MISMATCH/); writeFileSync(firstPath, firstContents);
  const extraEvidence = resolve(root, "artifacts/engineering-evidence/extra.json"); writeFileSync(extraEvidence, "{}\n"); assert.throws(() => certifierModule.requireCanonicalEvidenceFiles(attackPlan), /EVIDENCE_FILE_SET_MISMATCH/); unlinkSync(extraEvidence);
  matrix.proof.push("wrong-job-directory-rejected", "duplicate-proof-id-rejected", "missing-proof-file-rejected", "extra-proof-file-rejected", "merged-artifact-layout-rejected");
  const fakeBundle = resolve(root, "artifacts/engineering-attestation/fake.json"); mkdirSync(dirname(fakeBundle), { recursive: true }); writeFileSync(fakeBundle, "{}\n"); createdEvidence.push(fakeBundle);
  const syntheticAttack = command(root, process.execPath, ["scripts/engineering/proof-certify-ci.mjs", "--base", baseSha, "--head", currentHead, "--jobs", "success:success:success:success:success"], attackEnvironment);
  assert.equal(syntheticAttack.status, 2); assert.match(syntheticAttack.stderr, /ATTESTATION_VERIFICATION_FAILED|ATTESTATION_REQUIRED/); assert(!syntheticAttack.stdout.includes("REPOSITORY_PROOF_READY"));
  restorePreservedEvidence(); restoreDirectoryExistence(evidenceDirectory, evidenceBefore); assert.deepEqual(snapshotDirectory(evidenceDirectory), evidenceBefore, "PROOF_EVIDENCE_MUTATED_BY_TEST");
  matrix.attestation.push("synthetic-four-file-structurally-valid", "fake-bundle-rejected", "repository-certificate-not-emitted");
  rmSync(isolatedGit, { recursive: true, force: true }); tempRoots.splice(tempRoots.indexOf(isolatedGit), 1); isolatedRemoved = !existsSync(isolatedGit);
  assert(isolatedRemoved, "ISOLATED_STATE_FIXTURE_NOT_REMOVED");
  assert.deepEqual(snapshotDirectory(operationalDirectory), operationalBefore, "OPERATIONAL_SESSION_STORE_MUTATED_BY_TEST");
  matrix.state.push("operational-store-identical", "isolated-git-removed");

  for (const [text, expected, name] of [
    ["git status --short", CommandClass.READ_ONLY_ALLOWED, "git-read"], ["npm run kernel:test", CommandClass.REGISTERED_VERIFICATION_ALLOWED, "registered-test"],
    ["git branch", CommandClass.READ_ONLY_ALLOWED, "branch-list-default"], ["git branch --list", CommandClass.READ_ONLY_ALLOWED, "branch-list"], ["git branch -a", CommandClass.READ_ONLY_ALLOWED, "branch-all"], ["git branch -r", CommandClass.READ_ONLY_ALLOWED, "branch-remotes"], ["git branch -vv", CommandClass.READ_ONLY_ALLOWED, "branch-verbose"], ["git branch --show-current", CommandClass.READ_ONLY_ALLOWED, "branch-current"],
    ["git branch -d feature/x", CommandClass.PROHIBITED, "branch-delete"], ["git branch -D feature/x", CommandClass.PROHIBITED, "branch-force-delete"], ["git branch --delete feature/x", CommandClass.PROHIBITED, "branch-delete-long"], ["git branch -m old new", CommandClass.PROHIBITED, "branch-move"], ["git branch -M old new", CommandClass.PROHIBITED, "branch-force-move"], ["git branch feature/x", CommandClass.PROHIBITED, "branch-create"],
    ["git remote", CommandClass.READ_ONLY_ALLOWED, "remote-list"], ["git remote -v", CommandClass.READ_ONLY_ALLOWED, "remote-verbose"], ["git remote get-url origin", CommandClass.READ_ONLY_ALLOWED, "remote-url"], ["git remote show origin", CommandClass.READ_ONLY_ALLOWED, "remote-show"], ["git remote add upstream https://example.invalid/repo.git", CommandClass.PROHIBITED, "remote-add"], ["git remote set-url origin https://example.invalid/repo.git", CommandClass.PROHIBITED, "remote-set-url"],
    ["git worktree list", CommandClass.READ_ONLY_ALLOWED, "worktree-list"], ["git worktree list --porcelain", CommandClass.READ_ONLY_ALLOWED, "worktree-porcelain"], ["git worktree remove .worktrees/x", CommandClass.PROHIBITED, "worktree-remove"], ["git worktree prune", CommandClass.PROHIBITED, "worktree-prune"], ["git worktree add .worktrees/x chore/x", CommandClass.SCOPED_MUTATION_ALLOWED, "worktree-add-scoped"], ["git worktree add ../x main", CommandClass.PROHIBITED, "worktree-add-main"], ["git fetch origin main", CommandClass.REPOSITORY_METADATA_ALLOWED, "fetch-metadata"],
    ["git push origin chore/engineering-kernel-v4", CommandClass.SCOPED_MUTATION_ALLOWED, "feature-push"], ["git push origin main", CommandClass.PROHIBITED, "main-push"],
    ["git push origin HEAD:main", CommandClass.PROHIBITED, "refspec-main"], ["git push origin HEAD:refs/heads/main", CommandClass.PROHIBITED, "full-refspec-main"],
    ["git push origin feature/x --force", CommandClass.PROHIBITED, "force-last"], ["git push --force origin feature/x", CommandClass.PROHIBITED, "force-first"],
    ["git apply patch.diff", CommandClass.PROHIBITED, "git-apply"], ["git checkout -- file", CommandClass.PROHIBITED, "git-checkout"], ["git restore file", CommandClass.PROHIBITED, "git-restore"],
    ["node -e require('fs').writeFileSync('x','y')", CommandClass.PROHIBITED, "node-write"], ["python -c open('x','w')", CommandClass.PROHIBITED, "python-write"],
    ["node arbitrary.mjs", CommandClass.PROHIBITED, "node-script"], ["printf fixture > file", CommandClass.PROHIBITED, "redirect"], ["node fixture.mjs <<EOF", CommandClass.PROHIBITED, "heredoc"],
    ["bash -c fixture", CommandClass.PROHIBITED, "shell-wrapper"], ["supabase --project-ref X db push", CommandClass.PROHIBITED, "supabase-parameter"],
    ["supabase db push --project-ref X", CommandClass.PROHIBITED, "supabase-tail-parameter"], ["npx supabase db push", CommandClass.PROHIBITED, "supabase-npx"],
    ["npm exec -- supabase db push", CommandClass.PROHIBITED, "supabase-npm"], ["psql -f owner-fixture.sql", CommandClass.PROHIBITED, "psql"],
    ["npx vercel deploy", CommandClass.PROHIBITED, "vercel-npx"], ["npm exec -- vercel deploy", CommandClass.PROHIBITED, "vercel-npm"],
    ["terraform apply", CommandClass.PROHIBITED, "terraform"], ["docker rm fixture", CommandClass.PROHIBITED, "docker"], ["kubectl delete pod fixture", CommandClass.PROHIBITED, "kubectl"],
  ]) expectClass(text, expected, name);

  const ignoreRepo = temp("kernel-ignore-");
  assert.deepEqual(gitEnvironmentFor(ignoreRepo, { PATH: "fixture", GIT_DIR: "hostile", GIT_CONFIG_COUNT: "1", GIT_AUTHOR_NAME: "hostile" }), { PATH: "fixture", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: gitNullConfig }); matrix.state.push("disposable-git-environment-scrubbed");
  assert.equal(gitAt(ignoreRepo, "init", "-q", "-b", "main").status, 0); gitAt(ignoreRepo, "config", "user.email", "fixture@example.invalid"); gitAt(ignoreRepo, "config", "user.name", "Kernel Fixture");
  copyFileSync(resolve(root, ".gitignore"), resolve(ignoreRepo, ".gitignore")); writeFileSync(resolve(ignoreRepo, "baseline.txt"), "baseline\n");
  assert.equal(gitAt(ignoreRepo, "add", ".gitignore", "baseline.txt").status, 0); assert.equal(gitAt(ignoreRepo, "-c", "user.email=fixture@example.invalid", "-c", "user.name=Kernel Fixture", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "baseline").status, 0);
  const ignoreContents = readFileSync(resolve(root, ".gitignore"), "utf8"), workflowContents = readFileSync(resolve(root, ".github/workflows/product-verification.yml"), "utf8"), ignoredBaseline = dirtyFingerprint(ignoreRepo);
  const statusIsClean = () => assert.equal(gitAt(ignoreRepo, "status", "--porcelain").stdout, "");
  const writeIgnoreFixture = (path, contents) => { const absolute = resolve(ignoreRepo, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, contents); return absolute; };
  const verifierIgnorePaths = ["artifacts/engineering-evidence/", "artifacts/engineering-attestation/"].map((path) => String.fromCharCode(47) + path);
  for (const path of verifierIgnorePaths) assert.equal(ignoreContents.split(/\r?\n/).filter((line) => line === path).length, 1);
  assert(!workflowContents.includes(".git/info/exclude")); assert(!workflowContents.includes("core.excludesFile"));
  for (const artifact of ["kernel-preflight", "kernel-unit-build", "kernel-postgres", "kernel-e2e", "kernel-evidence-attestation"]) assert(workflowContents.includes(`name: ${artifact}`));
  assert(workflowContents.includes("proof:run -- --kind handover"));
  assert(workflowContents.includes("npm run proof:certify-ci")); assert.match(workflowContents, /verify:\s*\n\s*needs: \[preflight, unit-build, receivables-postgres, e2e, attest-evidence\]/);
  statusIsClean(); assert.equal(dirtyFingerprint(ignoreRepo), ignoredBaseline);
  writeIgnoreFixture("artifacts/engineering-evidence/preflight/fixture.json", "{}\n");
  assert.equal(gitAt(ignoreRepo, "check-ignore", "-q", "artifacts/engineering-evidence/preflight/fixture.json").status, 0); statusIsClean(); assert.equal(dirtyFingerprint(ignoreRepo), ignoredBaseline);
  writeIgnoreFixture("artifacts/engineering-attestation/fixture.jsonl", "{}\n");
  assert.equal(gitAt(ignoreRepo, "check-ignore", "-q", "artifacts/engineering-attestation/fixture.jsonl").status, 0); statusIsClean(); assert.equal(dirtyFingerprint(ignoreRepo), ignoredBaseline);
  writeIgnoreFixture("artifacts/engineering-evidence/preflight/both.json", "{}\n"); writeIgnoreFixture("artifacts/engineering-attestation/both.jsonl", "{}\n");
  statusIsClean(); assert.equal(dirtyFingerprint(ignoreRepo), ignoredBaseline);
  for (const path of ["scripts/unexpected-kernel-source.mjs", "artifacts/unexpected-source.mjs", "unexpected-kernel-source.mjs"]) assert.equal(gitAt(ignoreRepo, "check-ignore", "-q", path).status, 1, `OVERBROAD_IGNORE:${path}`);
  writeIgnoreFixture("unexpected-kernel-source.mjs", "export const unexpected = true;\n");
  assert.match(gitAt(ignoreRepo, "status", "--porcelain").stdout, /\?\? unexpected-kernel-source\.mjs/); assert.notEqual(dirtyFingerprint(ignoreRepo), ignoredBaseline);
  unlinkSync(resolve(ignoreRepo, "unexpected-kernel-source.mjs")); statusIsClean();
  writeFileSync(resolve(ignoreRepo, "baseline.txt"), "modified\n"); assert.notEqual(dirtyFingerprint(ignoreRepo), ignoredBaseline);
  matrix.state.push("verifier-input-ignore-contract", "ignored-evidence-clean", "ignored-attestation-clean", "ignored-inputs-combined-clean", "ordinary-untracked-fingerprint-sensitive", "tracked-modification-fingerprint-sensitive", "no-overbroad-artifacts-ignore", "workflow-no-local-ignore-mutation");

  const repo = temp("kernel-git-");
  assert.equal(gitAt(repo, "init", "-q", "-b", "main").status, 0); gitAt(repo, "config", "user.email", "fixture@example.invalid"); gitAt(repo, "config", "user.name", "Kernel Fixture");
  writeFileSync(resolve(repo, "base.txt"), "base\n"); gitAt(repo, "add", "base.txt"); gitAt(repo, "commit", "-q", "-m", "base");
  const base = gitAt(repo, "rev-parse", "HEAD").stdout.trim(), baseTree = gitAt(repo, "rev-parse", "HEAD^{tree}").stdout.trim(); gitAt(repo, "update-ref", "refs/remotes/origin/main", base); gitAt(repo, "checkout", "-q", "-b", "feature"); writeFileSync(resolve(repo, "head.txt"), "head\n"); gitAt(repo, "add", "head.txt"); gitAt(repo, "commit", "-q", "-m", "head");
  const cleanFingerprint = dirtyFingerprint(repo), fingerprintPath = resolve(repo, "fingerprint.txt"); writeFileSync(fingerprintPath, "one\n"); const firstFingerprint = dirtyFingerprint(repo); writeFileSync(fingerprintPath, "two\n");
  assert.notEqual(cleanFingerprint, firstFingerprint); assert.notEqual(firstFingerprint, dirtyFingerprint(repo)); unlinkSync(fingerprintPath); matrix.state.push("content-sensitive-worktree");
  const head = gitAt(repo, "rev-parse", "HEAD").stdout.trim(), staleBase = gitAt(repo, "commit-tree", "HEAD^{tree}", "-m", "unrelated").stdout.trim();
  const fixture = resolve(temp("kernel-gh-fixture-"), "gh-fixture.mjs");
  const protectedChecks = protectedRequiredChecks.map((name) => ({ name, state: "SUCCESS", bucket: "pass", link: "" })), workflowChecks = requiredRemoteChecks.map((name) => ({ name, state: "SUCCESS", bucket: "pass", link: "" }));
  writeFileSync(fixture, `const a=process.argv.slice(2),s=process.env.SCENARIO;if(a[0]==='pr'&&a[1]==='view'){if(s==='no-pr'){console.error('no pull requests found');process.exit(1)}const base=s==='stale-base'?process.env.STALE_BASE:process.env.BASE_SHA;console.log(JSON.stringify({number:123,headRefOid:s==='wrong-head'?'0'.repeat(40):process.env.HEAD_SHA,baseRefOid:base,baseRefName:'main',url:'https://example.invalid/pr/123'}));process.exit(0)}if(s==='auth'){console.error('authentication network unavailable');process.exit(1)}if(s==='malformed'){console.log('{bad');process.exit(1)}const required=a.includes('--required');let rows=required?${JSON.stringify(protectedChecks)}:${JSON.stringify(workflowChecks)};if(required&&s==='missing-protected-verify')rows=rows.filter(x=>x.name!=='verify');if(required&&s==='duplicate-protected')rows.push({...rows[0]});if(!required&&s==='missing-attest')rows=rows.filter(x=>x.name!=='attest-evidence');if(!required&&s==='pending-unit')rows=rows.map(x=>x.name==='unit-build'?{...x,state:'PENDING',bucket:'pending'}:x);if(!required&&s==='failed-attest')rows=rows.map(x=>x.name==='attest-evidence'?{...x,state:'FAILURE',bucket:'fail'}:x);if(!required&&s==='duplicate-workflow')rows.push({...rows.find(x=>x.name==='verify')});if(!required&&s==='optional-failed')rows.push({name:'optional',state:'FAILURE',bucket:'fail',link:''});if(required&&s==='pending-nonzero')rows[0]={...rows[0],state:'PENDING',bucket:'pending'};if(required&&s==='failed-nonzero')rows[0]={...rows[0],state:'FAILURE',bucket:'fail'};console.log(JSON.stringify(rows));process.exit(['pending-nonzero','failed-nonzero'].includes(s)&&required?1:0);`);
  const gate = (scenario) => remoteGate({ cwd: repo, gh: (args) => command(repo, process.execPath, [fixture, ...args], { SCENARIO: scenario, HEAD_SHA: head, BASE_SHA: base, STALE_BASE: staleBase }) });
  assert.equal(gate("success").status, "READY_TO_END"); assert.equal(gate("missing-attest").status, "REMOTE_FAILED"); assert.equal(gate("pending-unit").status, "REMOTE_PENDING"); assert.equal(gate("failed-attest").status, "REMOTE_FAILED");
  assert.equal(gate("missing-protected-verify").status, "REMOTE_FAILED"); assert.equal(gate("duplicate-protected").status, "REMOTE_FAILED"); assert.equal(gate("duplicate-workflow").status, "REMOTE_FAILED"); assert.equal(gate("optional-failed").status, "READY_TO_END");
  assert.equal(gate("pending-nonzero").status, "REMOTE_PENDING"); assert.equal(gate("failed-nonzero").status, "REMOTE_FAILED"); assert.equal(gate("auth").status, "EXTERNAL_DEPENDENCY"); assert.equal(gate("malformed").status, "REMOTE_FAILED");
  assert.equal(gate("wrong-head").reason, "HEAD_MISMATCH"); assert.equal(gate("stale-base").reason, "BASE_NOT_ANCESTOR"); assert.equal(gate("no-pr").status, "PR_REQUIRED");
  process.env.stop_hook_active = "true"; assert.equal(gate("failed-attest").status, "REMOTE_FAILED"); delete process.env.stop_hook_active;
  const stopState = { taskId: "fixture", resolution: { status: "RESOLVED" }, baseline: { headSha: base, treeSha: baseTree, baseSha: base, dirtyFingerprint: cleanFingerprint }, evidence: [{ status: "PASS", name: "TASK_CERTIFIED", ownerApproval: true }] };
  let remoteCalls = 0; writeFileSync(fingerprintPath, "forged-local-change\n");
  const dirtyStop = evaluateStopState({ state: stopState, cwd: repo, remote: () => { remoteCalls += 1; return { status: "READY_TO_END" }; } });
  assert.equal(dirtyStop.status, "WORKTREE_DIRTY_COMMIT_REQUIRED"); assert.equal(remoteCalls, 0); assert(!JSON.stringify(dirtyStop).includes("TASK_CERTIFIED")); unlinkSync(fingerprintPath);
  assert.equal(evaluateStopState({ state: stopState, cwd: repo, remote: () => gate("success") }).status, "READY_TO_END");
  assert.equal(evaluateStopState({ state: { ...stopState, baseline: { headSha: head, treeSha: gitAt(repo, "rev-parse", "HEAD^{tree}").stdout.trim(), baseSha: base, dirtyFingerprint: cleanFingerprint } }, cwd: repo, remote: () => { throw new Error("REMOTE_MUST_NOT_RUN"); } }).status, "IMPLEMENTATION_IN_PROGRESS");
  matrix.stopRemote.push("protected-four-workflow-six-pass", "workflow-attestation-missing", "workflow-unit-pending", "workflow-attestation-failed", "protected-verify-missing", "protected-duplicate", "workflow-gate-duplicate", "optional-failure-ignored", "pending-json-nonzero", "failed-json-nonzero", "auth-external", "malformed-closed", "head-mismatch", "stale-base", "no-pr", "active-flag-no-bypass", "dirty-forged-local-blocked-before-remote", "no-task-certified-or-owner-approval");

  let stallState = { status: "IMPLEMENTATION_IN_PROGRESS", stallCount: 0 }, advance = (result) => { const decision = applyStallPolicy(stallState, result); stallState = { ...stallState, ...decision.state }; return decision; }, stallDecision;
  stallDecision = advance({ status: "IMPLEMENTATION_IN_PROGRESS" }); assert.equal(stallDecision.state.stallCount, 1); assert.equal(stallDecision.continuation, "FOCUSED_RETRY");
  stallDecision = advance({ status: "IMPLEMENTATION_IN_PROGRESS" }); assert.equal(stallDecision.state.stallCount, 2); assert.equal(stallDecision.continuation, "STRATEGY_CHANGE_REQUIRED");
  stallDecision = advance({ status: "IMPLEMENTATION_IN_PROGRESS" }); assert.equal(stallDecision.result.status, "STALL_LIMIT"); assert.equal(stallDecision.state.stallCount, 3); assert.equal(stallDecision.continuation, undefined);
  stallDecision = advance({ status: "IMPLEMENTATION_IN_PROGRESS" }); assert.equal(stallDecision.result.status, "STALL_LIMIT"); assert.equal(stallDecision.state.stallCount, 3); assert.equal(stallDecision.continuation, undefined);
  stallDecision = advance({ status: "IMPLEMENTATION_IN_PROGRESS", reason: "CHANGED_PROGRESS" }); assert.equal(stallDecision.state.stallCount, 1); assert.equal(stallDecision.continuation, "FOCUSED_RETRY");
  for (let count = 0; count < 4; count += 1) { stallDecision = advance({ status: "REMOTE_PENDING" }); assert.equal(stallDecision.result.status, "REMOTE_PENDING"); assert.equal(stallDecision.state.stallCount, 0); }
  for (let count = 0; count < 4; count += 1) { stallDecision = advance({ status: "EXTERNAL_DEPENDENCY" }); assert.equal(stallDecision.result.status, "EXTERNAL_DEPENDENCY"); assert.equal(stallDecision.state.stallCount, 0); }
  matrix.stall.push("focused-retry-count-1", "strategy-change-count-2", "stall-limit-count-3", "fourth-remains-stall-limit", "changed-signature-resets", "remote-pending-suspended", "external-dependency-suspended", "dirty-no-remote", "active-flag-no-bypass", "operational-store-unchanged");

  writeFileSync(resolve(repo, "old.mjs"), "export const oldValue=1;\n"); gitAt(repo, "add", "old.mjs"); gitAt(repo, "commit", "-q", "-m", "old"); gitAt(repo, "mv", "old.mjs", "new.mjs");
  const renameEntries = parseNameStatus(gitAt(repo, "diff", "--name-status", "-z", "--cached").stdout); assert.equal(renameEntries[0].status, "R"); assert.equal(renameEntries[0].oldPath, "old.mjs"); assert.equal(renameEntries[0].path, "new.mjs");
  assert.equal(gitAt(repo, "commit", "-q", "-m", "rename").status, 0); assert.equal(gitAt(repo, "rm", "-q", "new.mjs").status, 0); assert.equal(parseNameStatus(gitAt(repo, "diff", "--name-status", "-z", "--cached").stdout)[0].status, "D");
  for (const path of ["tools/unmapped-runner.mjs", "config/tool.ini", "db/queries.prisma"]) {
    const impact = compileImpact({ entries: [{ status: "A", path }], patch: "" }); assert.equal(impact.risk, "R3"); assert.equal(impact.writable, false); assert(impact.unresolved.some((item) => item.code === "UNMAPPED_PATH"));
  }
  const multiline = compileImpact({ entries: [{ status: "M", path: "src/lib/pipeline/contract.ts" }], patch: "+const result = supabase\n+  .from(\"leads\")\n+  .update({ status: \"won\" })\n+  .eq(\"id\", leadId);" });
  assert(multiline.changedAuthorities.includes("pipeline_stage")); assert.equal(multiline.writable, true);
  const unknownAuthority = compileImpact({ entries: [{ status: "M", path: "src/lib/pipeline/contract.ts" }], patch: "+await supabase.from(\"unknown_fixture\").update({ value: 1 });" });
  assert(unknownAuthority.unresolved.some((item) => item.code === "AUTHORITY_UNRESOLVED")); assert.equal(unknownAuthority.writable, false);
  const prohibitedAuthority = compileImpact({ entries: [{ status: "M", path: "src/app/mappings/page.tsx" }], patch: "+await supabase.from(\"leads\").update({ status: \"won\" });" });
  assert(prohibitedAuthority.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY"));
  const ledger = (boundary, immutableThrough = boundary) => ({ schemaVersion: 1, source: "fixture", lastAppliedOwnerMigration: boundary, immutableThrough });
  const migration = (number, name = "fixture") => `supabase/migrations/${String(number).padStart(3, "0")}_${name}.sql`;
  const transition = ({ baseBoundary = 51, headBoundary = baseBoundary, basePaths = [migration(baseBoundary)], headPaths = [migration(headBoundary)], changes = [] } = {}) => validateMigrationBoundaryTransition({ baseLedger: ledger(baseBoundary), headLedger: ledger(headBoundary), baseMigrationPaths: basePaths, headMigrationPaths: headPaths, changes });
  assert.equal(parseMigrationNumber(migration(52)), 52); assert.equal(parseMigrationNumber("supabase/migrations/patch_052.sql"), null); assert.throws(() => validateMigrationLedger(null), /MIGRATION_LEDGER_INVALID/); assert.throws(() => validateMigrationLedger(ledger(52, 51)), /MIGRATION_LEDGER_INVALID/);
  assert.equal(transition({ headPaths: [migration(51), migration(52)], changes: [{ status: "A", path: migration(52) }] }).transition, "STABLE_CURRENT_BOUNDARY");
  assert.equal(transition({ headBoundary: 52, headPaths: [migration(51), migration(52)], changes: [{ status: "A", path: migration(52) }] }).transition, "LEGAL_SINGLE_STEP_CERTIFICATION");
  assert.equal(transition({ headBoundary: 52, basePaths: [migration(51), migration(52)], headPaths: [migration(51), migration(52)] }).transition, "LEGAL_SINGLE_STEP_CERTIFICATION");
  assert.throws(() => transition({ headBoundary: 52, headPaths: [migration(51)] }), /CERTIFIED_MIGRATION_MISSING/);
  assert.throws(() => transition({ headBoundary: 53, headPaths: [migration(51), migration(53)] }), /MIGRATION_BOUNDARY_JUMP/);
  assert.throws(() => transition({ baseBoundary: 52, headBoundary: 51, basePaths: [migration(52)], headPaths: [migration(51)] }), /MIGRATION_BOUNDARY_ROLLBACK/);
  for (const changes of [[{ status: "M", path: migration(51) }], [{ status: "D", path: migration(51) }], [{ status: "R", oldPath: migration(51), path: migration(99) }]]) assert.throws(() => transition({ headPaths: [migration(51), migration(99)], changes }), /IMMUTABLE_MIGRATION_CHANGED/);
  for (const changes of [[{ status: "M", path: migration(52) }], [{ status: "D", path: migration(52) }], [{ status: "R", oldPath: migration(52), path: migration(99) }]]) assert.throws(() => transition({ baseBoundary: 52, basePaths: [migration(52)], headPaths: [migration(52), migration(99)], changes }), /IMMUTABLE_MIGRATION_CHANGED/);
  assert.throws(() => transition({ headBoundary: 52, headPaths: [migration(51), migration(52, "one"), migration(52, "two")] }), /DUPLICATE_MIGRATION_NUMBER/);
  assert.throws(() => transition({ headBoundary: 52, basePaths: [migration(51), migration(60)], headPaths: [migration(51), migration(52)], changes: [{ status: "R", oldPath: migration(60), path: migration(52) }] }), /CERTIFIED_MIGRATION_IDENTITY_INVALID/);
  assert.throws(() => validateMigrationBoundaryTransition({ baseLedger: ledger(51), headLedger: ledger(52, 51), baseMigrationPaths: [migration(51)], headMigrationPaths: [migration(51), migration(52)] }), /MIGRATION_LEDGER_INVALID/);
  assert.throws(() => transition({ basePaths: [migration(50)], headPaths: [migration(50), migration(51)] }), /CERTIFIED_MIGRATION_MISSING/);
  const currentMigration = inspectMigrationBoundaryTransition(); assert.equal(currentMigration.migrationBoundary, `${currentMigration.immutableThrough}/${currentMigration.immutableThrough}`); assert.equal(currentMigration.nextLegalMigration, currentMigration.immutableThrough + 1); assert.equal(currentMigration.transition, currentMigration.immutableThrough === currentMigration.baseImmutableThrough ? "STABLE_CURRENT_BOUNDARY" : "LEGAL_SINGLE_STEP_CERTIFICATION");
  const forwardMigration = compileImpact({ entries: [{ status: "A", path: migration(52) }], patch: "", baseImmutableThrough: 51 }); assert(!forwardMigration.unresolved.some((item) => item.code === "IMMUTABLE_MIGRATION"));
  const immutable = compileImpact({ entries: [{ status: "M", path: migration(52) }], patch: "", baseImmutableThrough: 52 }); assert(immutable.unresolved.some((item) => item.code === "IMMUTABLE_MIGRATION"));
  const ledgerImpact = compileImpact({ entries: [{ status: "M", path: "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json" }], patch: "", baseImmutableThrough: 51 }); assert(ledgerImpact.domains.includes("engineering-control")); assert(!ledgerImpact.unresolved.some((item) => item.code === "UNMAPPED_PATH"));
  const dynamicDoctor = doctor({ ci: true }); assert.equal(dynamicDoctor.status, "KERNEL_HEALTHY", JSON.stringify(dynamicDoctor)); assert.equal(dynamicDoctor.migrationBoundary, currentMigration.migrationBoundary); assert.equal(dynamicDoctor.immutableThrough, currentMigration.immutableThrough); assert.equal(dynamicDoctor.nextLegalMigration, currentMigration.nextLegalMigration); assert.equal(dynamicDoctor.transition, currentMigration.transition);
  const authorityFacts = JSON.parse(readFileSync(resolve(root, "docs/engineering/AUTHORITIES.json"), "utf8")).facts, domainFacts = JSON.parse(readFileSync(resolve(root, "docs/engineering/DOMAIN_MAP.json"), "utf8")).domains;
  const migrationPath = "supabase/migrations/900_fixture.sql", mapMigration = (...ids) => domainFacts.map((domain) => ids.includes(domain.id) ? { ...domain, pathPatterns: [...(domain.pathPatterns ?? []), migrationPath] } : domain);
  const migrationImpact = (sql, ids, options = {}) => compileImpact({ entries: [{ status: "A", path: migrationPath }], patch: sql, domainRegistry: mapMigration(...ids), selectedDomains: options.selectedDomains ?? ids, ...options });
  const distributorSql = "alter table public.distributor_accounts add column erp_payment_status text; update public.distributor_accounts set erp_payment_status='paid' where renewal_date < current_date; select renewal_date from public.distributor_accounts;";
  const distributorFixture = migrationImpact(distributorSql, ["distributor-status", "renewals", "erp-partner"]);
  assert.equal(distributorFixture.risk, "R3"); assert.equal(distributorFixture.writable, true); assert.deepEqual(distributorFixture.changedAuthorities, ["distributor_account"]); assert.deepEqual(distributorFixture.writeOperations.map((item) => item.writtenColumns), [["erp_payment_status"], ["erp_payment_status"]]);
  const withoutNewField = authorityFacts.map((fact) => fact.id === "distributor_account" ? { ...fact, writeSelectors: fact.writeSelectors.filter((selector) => selector.column !== "erp_payment_status") } : fact), unknownColumn = migrationImpact(distributorSql, ["distributor-status", "renewals", "erp-partner"], { authorityRegistry: withoutNewField });
  assert.equal(unknownColumn.writable, false); assert(unknownColumn.unresolved.some((item) => item.code === "AUTHORITY_UNRESOLVED")); assert(!unknownColumn.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY" && item.authority === "renewal"));
  const erpRenewalWrite = compileImpact({ entries: [{ status: "M", path: "src/app/api/erp-partner/distributors/route.ts" }], patch: "await db.query(`update public.distributor_accounts set renewal_date=current_date;`);", selectedDomains: ["distributor-status"] });
  assert(erpRenewalWrite.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY" && item.authority === "renewal"));
  const renewalWrite = migrationImpact("update public.distributor_accounts set renewal_date=current_date;", ["renewals"]); assert.equal(renewalWrite.writable, true); assert.deepEqual(renewalWrite.changedAuthorities, ["renewal"]);
  const financialWrite = compileImpact({ entries: [{ status: "M", path: "src/lib/distributors/contract.ts" }], patch: "await db.query(`update public.receivables set bill_amount=10;`);", selectedDomains: ["receivables"] });
  assert(financialWrite.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY" && item.authority === "receivable"));
  const financialRead = migrationImpact("select r.bill_amount,p.amount from public.receivables r join public.receivable_payments p using(receivable_id);", ["distributor-status"]); assert.equal(financialRead.writable, true); assert.deepEqual(financialRead.writeOperations, []);
  const functionFacts = authorityFacts.map((fact) => fact.id === "renewal" ? { ...fact, writeSelectors: [...fact.writeSelectors, { function: "public.fixture" }] } : fact), insideFunction = migrationImpact("create or replace function public.fixture() returns void language sql as $$ update public.distributor_accounts set renewal_date=current_date; $$;", ["renewals"], { authorityRegistry: functionFacts }); assert(insideFunction.writeOperations.some((item) => item.enclosingFunction === "public.fixture")); assert.equal(insideFunction.writable, true);
  const ambiguousFacts = [...authorityFacts, { id: "fixture_duplicate_renewal", authority: "fixture", writeSelectors: [{ schema: "public", resource: "distributor_accounts", column: "renewal_date" }] }], ambiguousAuthority = migrationImpact("update public.distributor_accounts set renewal_date=current_date;", ["renewals"], { authorityRegistry: ambiguousFacts }); assert(ambiguousAuthority.unresolved.some((item) => item.code === "AUTHORITY_AMBIGUOUS"));
  const sharedDelete = compileImpact({ entries: [{ status: "M", path: "src/lib/distributors/contract.ts" }], patch: "+await supabase.from('distributor_accounts').delete().eq('distributor_id', id);" }); assert(sharedDelete.unresolved.some((item) => item.code === "AUTHORITY_UNRESOLVED"));
  const taskInjection = compileImpact({ entries: [{ status: "M", path: "src/app/api/erp-partner/distributors/route.ts" }], patch: "+await supabase.from('distributor_accounts').update({ erp_payment_status: 'paid' });", selectedDomains: ["distributor-status"] }); assert(taskInjection.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY"));
  const legacyReplacement = resolveWriteAuthorities(extractSqlOperations(migrationPath, "update public.distributor_accounts set renewal_date=current_date;"), [{ id: "explicit-replaces", authority: "public.distributor_accounts.renewal_date", writeSelectors: [{ schema: "public", resource: "other" }] }]); assert(legacyReplacement.unresolved.some((item) => item.code === "AUTHORITY_UNRESOLVED"));

  const sourceCases = extractSourceOperations("fixture.ts", `
    const one={alpha:1}; const many=[{beta:1},{gamma:2}]; const spread={delta:1}; const literalKey='epsilon';
    client.schema('private').from('records').insert({alpha:1}); client.from('records').upsert(many); client.from('records').update(one);
    client.from('records').update({...spread}); client.from('records').update({...importedPayload}); client.from('records').update({[literalKey]:1}); client.from('records').update({['zeta']:1});
    client.from(tableName).update({alpha:1}); client.from().update({alpha:1}); client.rpc(rpcName,{}); client.query('update public.records set alpha=1'); client.execute(sqlText); client.from('records').delete();
  `);
  assert(sourceCases.some((item) => item.schema === "private" && item.writtenColumns.includes("alpha"))); assert(sourceCases.some((item) => item.operationKind === "upsert" && item.writtenColumns.includes("beta") && item.writtenColumns.includes("gamma"))); assert(sourceCases.some((item) => item.operationKind === "update" && item.writtenColumns.includes("delta") && item.columnsKnown));
  for (const code of ["WRITE_COLUMNS_UNKNOWN", "WRITE_TARGET_UNKNOWN", "RPC_EFFECT_UNKNOWN", "DYNAMIC_SQL_EFFECT_UNKNOWN"]) assert(sourceCases.some((item) => item.analysisError === code), code);
  assert(sourceCases.some((item) => item.parserEvidence === "TS_LITERAL_SQL" && item.operationKind === "update")); assert(sourceCases.some((item) => item.operationKind === "delete" && item.wholeResourceMutation));
  assert.deepEqual(extractSourceOperations("generic.ts", "cache.delete(key); model.update(value);"), []);
  const partial = compileImpact({ entries: [{ status: "M", path: "src/lib/distributors/contract.ts" }], fileVersions: { "src/lib/distributors/contract.ts": { base: "const q=supabase.from('distributor_accounts');", head: "const q=supabase\n .from('distributor_accounts')\n .update({ activity_status:'active' });" } } }); assert(partial.writeOperations.some((item) => item.writtenColumns.includes("activity_status")));

  const sqlCases = extractSqlOperations(migrationPath, "update public.a set x=1; insert into public.a(x) values(1); delete from public.a; truncate public.a; merge into public.a using public.b on true when matched then update set x=2; alter table public.a add column y text, drop column z, rename column q to r; create policy p on public.a using(true); alter table public.a enable row level security; grant select on public.a to anon;");
  for (const kind of ["update", "insert", "delete", "truncate", "merge", "alter_table_add_column", "alter_table_drop_column", "alter_table_rename_column", "policy_change", "rls_change", "grant_privilege"]) assert(sqlCases.some((item) => item.operationKind === kind), kind);
  const functionFiles = [{ path: migrationPath, text: "create function public.read_leaf() returns int language sql stable as $$ select 1 $$; create function public.write_leaf() returns void language sql as $$ update public.distributor_accounts set activity_status='active'; $$; create function public.read_parent() returns int language sql stable as $$ select public.read_leaf() $$; create function public.write_parent() returns void language sql as $$ select public.write_leaf() $$; create function public.unknown_parent() returns void language sql as $$ select public.missing_function() $$;", contentHash: "a".repeat(64) }], catalogue = buildSqlFunctionCatalogue(functionFiles);
  assert.equal(catalogue.get("public.read_parent").effect, "READ"); assert.equal(catalogue.get("public.write_parent").effect, "WRITE"); assert.equal(catalogue.get("public.unknown_parent").effect, "UNKNOWN");
  const dynamicFunction = buildSqlFunctionCatalogue([{ path: migrationPath, text: "create function public.dynamic_fn() returns void language plpgsql as $$ begin execute 'update public.a set x=1'; end $$;", contentHash: "b".repeat(64) }]); assert.equal(dynamicFunction.get("public.dynamic_fn").effect, "UNKNOWN");
  const commandFiles = [{ path: migrationPath, text: "create function public.single_command() returns void language sql security definer as $$ update public.distributor_accounts set activity_status='active'; $$; create function public.multi_command() returns void language sql security definer as $$ update public.distributor_accounts set activity_status='active'; update public.receivables set bill_amount=10; $$;", contentHash: "e".repeat(64) }], commandCatalogue = buildSqlFunctionCatalogue(commandFiles);
  const missingDeclaration = deriveFunctionAuthorities(commandCatalogue, authorityFacts, { functionNames: new Set(["public.single_command"]) }); assert.equal(missingDeclaration.results[0].authorityMode, "DERIVED_SINGLE_AUTHORITY"); assert.equal(missingDeclaration.results[0].authority, "distributor_account"); assert.equal(missingDeclaration.reconciliations[0].code, "INTERNAL_REGISTRY_RECONCILIATION"); assert.deepEqual(missingDeclaration.unresolved, []);
  const declaredCommandFacts = authorityFacts.map((fact) => fact.id === "distributor_account" ? { ...fact, writeSelectors: [...fact.writeSelectors, { function: "public.single_command" }] } : fact), declaredCommand = deriveFunctionAuthorities(commandCatalogue, declaredCommandFacts, { functionNames: new Set(["public.single_command"]) }); assert.equal(declaredCommand.results[0].registryStatus, "DECLARATION_MATCHED"); assert.deepEqual(declaredCommand.unresolved, []);
  const wrongCommandFacts = authorityFacts.map((fact) => fact.id === "renewal" ? { ...fact, writeSelectors: [...fact.writeSelectors, { function: "public.single_command" }] } : fact), wrongCommand = deriveFunctionAuthorities(commandCatalogue, wrongCommandFacts, { functionNames: new Set(["public.single_command"]) }); assert(wrongCommand.unresolved.some((item) => item.code === "FUNCTION_AUTHORITY_MISMATCH"));
  const incompleteCommandFacts = authorityFacts.map((fact) => fact.id === "distributor_account" ? { ...fact, writeSelectors: [...fact.writeSelectors, { function: "public.multi_command" }] } : fact), incompleteCommand = deriveFunctionAuthorities(commandCatalogue, incompleteCommandFacts, { functionNames: new Set(["public.multi_command"]) }); assert(incompleteCommand.unresolved.some((item) => item.code === "FUNCTION_AUTHORITY_MISMATCH"));
  const orchestrationFacts = [...authorityFacts, { id: "fixture_orchestration", kind: "ORCHESTRATION_CAPABILITY_ONLY", authority: "delegates only", writeSelectors: [{ function: "public.multi_command", delegatedAuthorities: ["distributor_account", "receivable"] }] }], orchestration = deriveFunctionAuthorities(commandCatalogue, orchestrationFacts, { functionNames: new Set(["public.multi_command"]) }); assert.equal(orchestration.results[0].authorityMode, "DERIVED_ORCHESTRATION"); assert.deepEqual(orchestration.results[0].authorities, ["distributor_account", "receivable"]); assert.deepEqual(orchestration.unresolved, []);
  const missingOrchestration = deriveFunctionAuthorities(commandCatalogue, authorityFacts, { functionNames: new Set(["public.multi_command"]) }); assert(missingOrchestration.unresolved.some((item) => item.code === "FUNCTION_AUTHORITY_AMBIGUOUS"));
  const stableRpc = compileImpact({ entries: [{ status: "M", path: "src/lib/distributors/reader.ts" }], fileVersions: { "src/lib/distributors/reader.ts": { base: "", head: "await supabase.rpc('read_parent', {});" } }, sqlCatalogueFiles: { base: [], head: functionFiles } }); assert.equal(stableRpc.writable, true); assert.equal(stableRpc.writeOperations.length, 0); assert.equal(stableRpc.readOperations[0].functionName, "public.read_parent");
  const unknownRpc = compileImpact({ entries: [{ status: "M", path: "src/lib/distributors/reader.ts" }], fileVersions: { "src/lib/distributors/reader.ts": { base: "", head: "await supabase.rpc('external_missing', {});" } } }); assert(unknownRpc.unresolved.some((item) => item.code === "RPC_EFFECT_UNKNOWN"));
  matrix.risk.push("nul-rename-delete", "sensitive-unmapped-r3", "multiline-fact-write-detected", "unknown-authority", "prohibited-authority", "immutable-migration-001-051", "generic-migration-boundary-transition-matrix", "base-boundary-immutability", "dynamic-doctor-boundary", "pr90-reproduction", "new-column-selector-required", "domain-local-prohibition", "renewal-owned-migration", "financial-write-isolation", "financial-read-only", "sql-function-enclosure", "authority-ambiguity", "full-file-partial-hunk", "structured-supabase-payloads", "dynamic-write-fail-closed", "sql-ddl-dml-matrix", "recursive-rpc-effects", "stable-rpc-read-only", "selected-domain-no-authority", "shared-delete-blocked", "rpc-derived-single-reconciliation", "rpc-declaration-match", "rpc-declaration-mismatch", "rpc-omitted-write-mismatch", "rpc-valid-orchestration", "rpc-missing-orchestration-blocked");

  const graphRoot = temp("kernel-graphify-"), graphPath = resolve(graphRoot, "graphify-out/graph.json"), stampPath = resolve(graphRoot, "graphify-out/.crm-head"), cachePath = resolve(graphRoot, "cache/result.json"), graphHead = "1".repeat(40), graphIndex = { files: [{ path: "src/lib/distributors/contract.ts", contentHash: "c".repeat(64) }] };
  mkdirSync(dirname(graphPath), { recursive: true }); writeFileSync(graphPath, "{}\n"); writeFileSync(stampPath, `${graphHead}\n`);
  let graphQueries = 0;
  const graphSpawn = (_file, args) => args[0] === "--version" ? { status: 0, stdout: "graphify 0.9.48\n", stderr: "" } : (graphQueries += 1, { status: 0, stdout: "src\\lib\\distributors\\contract.ts\nuntracked\\escape.ts\n", stderr: "" });
  const graphOptions = { root: graphRoot, graphPath, stampPath, cachePath, headSha: graphHead, executable: "fixture-graphify", spawn: graphSpawn };
  const graphFresh = queryGraphify("exact distributor task", graphIndex, graphOptions); assert.equal(graphFresh.status, "GRAPHIFY_QUERIED"); assert.deepEqual(graphFresh.paths, graphIndex.files); assert.equal(graphQueries, 1);
  const graphHit = queryGraphify("exact distributor task", graphIndex, graphOptions); assert.equal(graphHit.status, "GRAPHIFY_CACHE_HIT"); assert.equal(graphQueries, 1);
  const changedIndex = { files: [{ ...graphIndex.files[0], contentHash: "d".repeat(64) }] }; queryGraphify("exact distributor task", changedIndex, graphOptions); assert.equal(graphQueries, 2, "stale content hash must invalidate cache");
  writeFileSync(stampPath, `${"2".repeat(40)}\n`); queryGraphify("exact distributor task", changedIndex, { ...graphOptions, headSha: "2".repeat(40) }); assert.equal(graphQueries, 3, "head change must invalidate cache identity");
  assert.equal(queryGraphify("stale graph task", graphIndex, { ...graphOptions, headSha: "3".repeat(40) }).status, "STALE_GRAPH");
  writeFileSync(stampPath, `${graphHead}\n`);
  assert.equal(queryGraphify("missing binary task", graphIndex, { ...graphOptions, cachePath: resolve(graphRoot, "cache/missing.json"), spawn: () => ({ status: null, stdout: "", stderr: "", error: { code: "ENOENT" } }) }).status, "GRAPHIFY_BINARY_UNAVAILABLE");
  let timeoutCalls = 0; const timeoutSpawn = () => ++timeoutCalls === 1 ? { status: 0, stdout: "graphify 0.9.48", stderr: "" } : { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } };
  assert.equal(queryGraphify("timeout task", graphIndex, { ...graphOptions, cachePath: resolve(graphRoot, "cache/timeout.json"), spawn: timeoutSpawn }).status, "GRAPHIFY_TIMEOUT");
  let malformedCalls = 0; const malformedSpawn = () => ++malformedCalls === 1 ? { status: 0, stdout: "graphify 0.9.48", stderr: "" } : { status: 0, stdout: "{bad json", stderr: "" };
  assert.equal(queryGraphify("malformed task", graphIndex, { ...graphOptions, cachePath: resolve(graphRoot, "cache/malformed.json"), spawn: malformedSpawn }).status, "GRAPHIFY_MALFORMED_OUTPUT");
  matrix.risk.push("graphify-fresh", "graphify-cache-hit", "graphify-head-invalidation", "graphify-stale-content", "graphify-timeout", "graphify-stale-graph", "graphify-missing-binary", "graphify-malformed", "graphify-windows-path", "graphify-untracked-path-rejected", "graphify-one-query-per-identity");

  const pr90Base = "dfc379d75c3f9f9f0e34931bd8438cd97e8dd705", pr90Head = "20da212a592e70309c5c5f219f30011c233e572f", pr90WithoutSelectors = compileImpact({ base: pr90Base, head: pr90Head });
  assert.equal(pr90WithoutSelectors.writable, false); assert(pr90WithoutSelectors.unresolved.some((item) => item.code === "AUTHORITY_UNRESOLVED")); assert(!pr90WithoutSelectors.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY" && item.authority === "renewal")); assert.equal(pr90WithoutSelectors.writeResolutions.filter((item) => ["renewal", "receivable", "payment"].includes(item.authority)).length, 0);
  const pr90Overlay = compileImpact({ base: pr90Base, head: pr90Head, authorityRegistry: authorityFacts });
  assert.equal(pr90Overlay.writable, true, JSON.stringify(pr90Overlay.unresolved)); assert.equal(pr90Overlay.risk, "R3"); assert.deepEqual(pr90Overlay.changedAuthorities, ["distributor_account"]); assert.equal(pr90Overlay.writeResolutions.filter((item) => ["renewal", "receivable", "payment"].includes(item.authority)).length, 0);
  const pr90Command = pr90Overlay.functionAuthorities.find((item) => item.functionName === "public.distributor_erp_payment_status_command_v1"); assert.equal(pr90Command.authorityMode, "DERIVED_SINGLE_AUTHORITY"); assert.equal(pr90Command.authority, "distributor_account"); assert.equal(pr90Command.registryStatus, "DECLARATION_MATCHED");
  matrix.risk.push("pr90-without-selector-unresolved", "pr90-no-false-renewal-write", "pr90-overlay-writable-r3", "pr90-command-body-selector-equality", "pr90-financial-read-only");

  const impact = { ...compileImpact({ entries: [{ status: "M", path: "scripts/engineering/kernel.test.mjs" }], patch: "" }), domains: ["engineering-control"], effects: ["ENGINEERING_CONTROL"], risk: "R3", unresolved: [], writable: true };
  const plan = compileProofPlan({ impact }); for (const kind of ["unit", "build", "postgres", "e2e"]) assert(plan.requiredByKind[kind].length, `domain proof missing ${kind}`);
  assert(compileProofPlan({ impact: { ...impact, domains: [], risk: "R3" } }).requiredProofs.length > 0);
  assert.throws(() => certifierModule.requireCanonicalEvidenceFiles({ requiredProofs: ["missing-required-proof"] }), /EVIDENCE_FILE_SET_MISMATCH|EVIDENCE_DIRECTORY_MISSING|PROOF_UNMAPPED/);
  matrix.proof.push("missing-required-proof-rejected");
  assert.equal(containsAssertionWeakening(`npx jest --update${"Snapshot"}`), true); assert.equal(containsAssertionWeakening("npx jest --runInBand"), false);
  const hostileEnvironment = { PGHOST: "production.example.invalid", PGPORT: "6543", PGDATABASE: "customer_prod", PGUSER: "prod_admin", PGPASSWORD: "secret", PGSERVICE: "production", PGPASSFILE: ["", "tmp", "prod.pgpass"].join("/"), GITHUB_TOKEN: "github-secret", GH_TOKEN: "gh-secret", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-secret", ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid", ACTIONS_RUNTIME_TOKEN: "runtime-secret", KEEP: "yes" };
  const isolated = safeEnvironment({ ...hostileEnvironment, NEXT_PUBLIC_SUPABASE_URL: "https://production.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-invalid", [["SUPABASE", "SERVICE_ROLE_KEY"].join("_")]: "synthetic-invalid" }); assert.deepEqual(isolated, { KEEP: "yes" });
  const postgresProof = JSON.parse(readFileSync(resolve(root, "docs/engineering/PROOFS.json"), "utf8")).proofs.find((proof) => proof.id === "control-postgres-matrix");
  const postgresPlan = compileRegisteredCommandPlan({ proof: postgresProof, baseSha, headSha: currentHead }), registeredPostgresCommand = postgresPlan.commands.find((item) => item.database);
  const postgresEnvironment = disposablePostgresEnvironment(registeredPostgresCommand, hostileEnvironment);
  const captured = command(root, process.execPath, ["-p", "JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key])=>/^PG|^CRM_(?:MASTER_DB|POSTGRES_SERVICE)_DISPOSABLE$/.test(key))))"], postgresEnvironment);
  assert.equal(captured.status, 0); const childEnvironment = JSON.parse(captured.stdout);
  assert.deepEqual(childEnvironment, { CRM_MASTER_DB_DISPOSABLE: "1", CRM_POSTGRES_SERVICE_DISPOSABLE: "1", PGDATABASE: registeredPostgresCommand.database, PGHOST: "127.0.0.1", PGPASSWORD: "postgres", PGPORT: "5432", PGSSLMODE: "disable", PGUSER: "postgres" });
  assert(!Object.values(childEnvironment).some((value) => Object.values(hostileEnvironment).includes(value)));
  let processExecuted = false;
  assert.throws(() => { assertDisposablePostgresEnvironment(registeredPostgresCommand, { ...postgresEnvironment, PGHOST: "production.example.invalid" }); processExecuted = true; }, /POSTGRES_DISPOSABLE/);
  assert.equal(processExecuted, false);
  matrix.postgresEnvironment.push("hostile-libpq-stripped", "registered-loopback-child", "external-target-pre-execution-rejected");
  matrix.tokenIsolation.push("non-postgres-no-pg", "proof-command-no-github-token", "proof-command-no-oidc-token");
  assert.equal(revalidateCandidate({ path: "scripts/engineering/fixtures/missing-candidate.mjs", contentHash: "0".repeat(64) }), false);
  assert.equal((await runReleaseSelfTest()).code, "CRM_RELEASE_TEST_PASS");
  assert.equal(validateReleaseReceipt({ status: "RELEASE_COMPLETE", releaseReceipt: "forged" }), false);
  const releaseHead = "a".repeat(40), releaseBase = "b".repeat(40), releaseBranch = "fix/release-fixture";
  const releaseChecks = TARGETS.requiredJobs.map((name) => ({ name, state: "SUCCESS", bucket: "pass", link: `https://example.invalid/${name}` }));
  const releasePr = { number: 123, url: "https://example.invalid/pr/123", headRefName: releaseBranch, headRefOid: releaseHead, baseRefName: "main", baseRefOid: releaseBase, state: "OPEN", isDraft: false, mergeable: "MERGEABLE" };
  const fakeGh = (_file, args) => ({ status: 0, stderr: "", stdout: JSON.stringify(args[1] === "view" ? releasePr : releaseChecks) });
  assert.equal((await waitForChecks({ runner: fakeGh, pr: 123, head: releaseHead, branch: releaseBranch, base: releaseBase, timeout: 10, interval: 0, wait: async () => {} })).length, 6);
  await assert.rejects(() => waitForChecks({ runner: fakeGh, pr: 123, head: "c".repeat(40), branch: releaseBranch, base: releaseBase, timeout: 0, interval: 0 }), /DRIFT/);
  const fakeVercel = (_file, args) => {
    if (args[0] === "teams") return { status: 0, stderr: "", stdout: JSON.stringify({ teams: [{ id: TARGETS.teamId, slug: TARGETS.team }] }) };
    if (args[0] === "project") return { status: 0, stderr: "", stdout: `Found Project ${TARGETS.team}/${TARGETS.project} ID ${TARGETS.projectId}` };
    if (args[0] === "list") return { status: 0, stderr: "", stdout: JSON.stringify({ contextName: TARGETS.team, deployments: [{ url: "fixture.vercel.app", name: TARGETS.project, state: "READY", target: null, createdAt: 1, meta: { githubCommitSha: releaseHead, githubCommitRef: releaseBranch, githubOrg: "Deep0202006", githubRepo: "CRM_Zero", githubDeployment: "1" } }] }) };
    return { status: 0, stderr: "", stdout: JSON.stringify({ id: "dpl_fixture", name: TARGETS.project, contextName: TARGETS.team, readyState: "READY", target: null }) };
  };
  assert.equal((await waitForGitDeployment({ runner: fakeVercel, branch: releaseBranch, head: releaseHead, target: "preview", timeout: 10, interval: 0, wait: async () => {} })).id, "dpl_fixture");
  const migrationRunner = (_file, args) => ({ status: 0, stderr: "", stdout: args[0] === "show" ? JSON.stringify({ schemaVersion: 1, lastAppliedOwnerMigration: args[1].startsWith(releaseHead) ? 52 : 52, immutableThrough: 52 }) : "A\tsupabase/migrations/053_fixture.sql" });
  assert.equal(inspectMigrationGate({ runner: migrationRunner, base: releaseBase, head: releaseHead }).status, "OWNER_REQUIRED");
  matrix.state.push("release-controller-fixtures", "release-receipt-forgery-rejected", "release-fake-gh-exact-head", "release-fake-vercel-git-preview", "release-migration-owner-gate");

  const index = buildSourceIndex({ writeCache: false }), criticalClaim = [{ id: "FIXTURE_CRITICAL", severity: "CRITICAL" }];
  const multiDomainContext = resolveContext({ task: "Distributor renewal external ERP partner projection", index }); assert.equal(multiDomainContext.status, "RESOLVED"); for (const id of ["distributor-status", "renewals", "erp-partner"]) assert(multiDomainContext.domains.includes(id)); assert(multiDomainContext.candidatePaths.length <= 7); assert(multiDomainContext.candidatePaths.some((item) => item.domainRoles.includes("WRITER_CANDIDATE"))); assert(multiDomainContext.candidatePaths.some((item) => item.domainRoles.some((role) => ["READER", "PROJECTION", "CALLER", "TEST", "CONTRACT"].includes(role))));
  const missingSemantic = executeRegressionCases({ cases: [{ id: "fixture-semantic", kind: "semantic", executorId: "missing", requiredClaims: ["FIXTURE_CRITICAL"], proofRefs: ["kernel-fixture-pass"] }], claims: criticalClaim, index });
  assert.match(missingSemantic.results[0].failureReason, /CASE_EXECUTOR_MISSING/); assert.equal(missingSemantic.coverageFailures.length, 1);
  const wrongBlocker = executeRegressionCases({ cases: [{ id: "platform-snapshot-blocker", kind: "blocker", expectedBlocker: "FALSE_BLOCKER", requiredClaims: ["FIXTURE_CRITICAL"] }], claims: criticalClaim, index });
  assert.equal(wrongBlocker.results[0].pass, false); assert.match(wrongBlocker.results[0].failureReason, /BLOCKER:SOURCE_SNAPSHOT_UNBOUND/);
  const missingControl = executeRegressionCases({ cases: [{ id: "fixture-control", kind: "control", executorId: "missing", requiredClaims: ["FIXTURE_CRITICAL"] }], claims: criticalClaim, index }); assert.match(missingControl.results[0].failureReason, /CASE_EXECUTOR_MISSING/);
  const unknownKind = executeRegressionCases({ cases: [{ id: "fixture-unknown", kind: "unknown", requiredClaims: ["FIXTURE_CRITICAL"] }], claims: criticalClaim, index }); assert.match(unknownKind.results[0].failureReason, /CASE_EXECUTOR_MISSING/);
  assert.throws(() => validateCaseResult({ caseId: "zero", executed: true, assertionCount: 0, pass: true }), /CASE_ZERO_ASSERTIONS/);
  matrix.regression.push("semantic-proofref-only-rejected", "false-blocker-rejected", "control-executor-missing", "unknown-kind-rejected", "zero-assertions-rejected", "unexecuted-critical-claim-rejected");

  assert.deepEqual(snapshotDirectory(resolve(root, "src")), productBefore, "PRODUCT_SOURCE_MUTATED_BY_TEST");
  assert.deepEqual(snapshotDirectory(resolve(root, "supabase/migrations")), migrationsBefore, "MIGRATION_SOURCE_MUTATED_BY_TEST");
  assert.deepEqual(snapshotDirectory(operationalDirectory), operationalBefore, "OPERATIONAL_SESSION_STORE_MUTATED_BY_TEST");
  console.log(JSON.stringify({ code: "KERNEL_ADVERSARIAL_MATRIX_PASS", operationalStateBefore: operationalBefore, operationalStateAfter: snapshotDirectory(operationalDirectory), matrix }));
} finally {
  restorePreservedEvidence();
  for (const path of createdEvidence) if (existsSync(path)) rmSync(path, { force: true });
  restoreDirectoryExistence(evidenceDirectory, evidenceBefore);
  for (const path of tempRoots) if (existsSync(path)) removeEngineeringTemp(path);
}
