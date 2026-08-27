import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyCommand, CommandClass } from "./command-policy.mjs";
import { buildSourceIndex } from "./source-index.mjs";
import { compileImpact, parseNameStatus } from "./impact.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import * as certifierModule from "./proof-certify-ci.mjs";
import { validateEvidenceFile } from "./proof-certify-ci.mjs";
import { evidencePayloadHash } from "./proof-evidence.mjs";
import { canonicalEvidencePath, runRegisteredProof } from "./proof-runner.mjs";
import { executeRegressionCases, validateCaseResult } from "./regression-executors.mjs";
import { revalidateCandidate } from "./context.mjs";
import { remoteGate } from "./hooks/stop.mjs";
import { beginExternalTask, compareAndSwap, loadState, requireContinuation, sessionPath, sessionsDirectory } from "./hooks/state-store.mjs";
import { dirtyFingerprint, git, repositoryIdentity, root, safeEnvironment, sha256 } from "./kernel-lib.mjs";
import { containsAssertionWeakening } from "../quality/assertion-policy.mjs";

const matrix = { state: [], risk: [], proof: [], commandPolicy: [], regression: [], stopRemote: [] }, tempRoots = [], createdEvidence = [];
const temp = (prefix) => { const path = mkdtempSync(resolve(tmpdir(), prefix)); tempRoots.push(path); return path; };
const command = (cwd, file, args, env, input) => spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, input });
const gitAt = (cwd, ...args) => command(cwd, "git", args);
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

const operationalDirectory = sessionsDirectory(), operationalBefore = snapshotDirectory(operationalDirectory);
let isolatedGit = "", isolatedRemoved = false;
try {
  const baseSha = git("rev-parse", "origin/main"), currentHead = git("rev-parse", "HEAD"), currentTree = git("rev-parse", "HEAD^{tree}");
  isolatedGit = temp("kernel-state-git-");
  assert.equal(command(root, "git", ["clone", "-q", "--bare", "--shared", root, isolatedGit]).status, 0);
  assert.equal(command(root, "git", ["--git-dir", isolatedGit, "config", "core.bare", "false"]).status, 0);
  assert.equal(command(root, "git", ["--git-dir", isolatedGit, "update-ref", "refs/remotes/origin/main", baseSha]).status, 0);
  assert.equal(command(root, "git", ["--git-dir", isolatedGit, "read-tree", "HEAD"]).status, 0);
  const isolatedEnvironment = { GIT_DIR: isolatedGit, GIT_WORK_TREE: root };
  await withEnvironment(isolatedEnvironment, async () => {
    assert.equal(repositoryIdentity().headSha, currentHead);
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

    const runPreTool = (cmd) => command(root, process.execPath, ["scripts/engineering/hooks/pre-tool.mjs"], isolatedEnvironment, JSON.stringify({ session_id: `kernel-test-${randomUUID()}`, tool_name: "exec_command", tool_input: { cmd } }));
    for (const cmd of ["node -e require('fs').writeFileSync('x','y')", "python -c open('x','w')", "git apply patch.diff", "git checkout -- file", "git restore file", "git push origin HEAD:main", "git push origin feature/x --force", "supabase --project-ref X db push", "npx supabase db push", "npm exec -- vercel deploy", "printf fixture > file", "powershell -EncodedCommand ZgBpAHgAdAB1AHIAZQA="]) {
      const hook = runPreTool(cmd); assert.equal(hook.status, 0); assert.match(hook.stdout, /SAFETY_CONFLICT:COMMAND_POLICY/);
    }
    assert.equal(runPreTool("git status --short").stdout, ""); assert.equal(runPreTool("git push origin chore/engineering-kernel-v4").stdout, "");
    matrix.risk.push("pretool-command-matrix-denied", "pretool-read-only-allowed", "pretool-feature-push-scoped");

    const identity = { schemaVersion: 1, baseSha, headSha: currentHead, treeSha: currentTree, dirtyFingerprint: dirtyFingerprint(), impactHash: "b".repeat(64), planHash: "a".repeat(64), requiredProofs: ["kernel-fixture-pass"], requiredByKind: { unit: ["kernel-fixture-pass"] }, notRequiredKinds: [] };
    const ciEnvironment = { CI: "true", GITHUB_REPOSITORY: "Deep0202006/CRM_Zero", GITHUB_WORKFLOW: "CRM Product Verification", GITHUB_RUN_ID: "123456", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "preflight", GITHUB_EVENT_NAME: "pull_request", KERNEL_BASE_SHA: baseSha, KERNEL_HEAD_SHA: currentHead };
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
    rejectMutation("unknown-field", (item) => item.callerAuthored = true, /unrecognized|Unrecognized|unknown/i);
    assert.equal(certifierModule.validateEvidenceItem, undefined, "in-memory evidence validator exposed");
    const selectedOutput = command(root, process.execPath, ["scripts/engineering/proof-runner.mjs", "--proof", "kernel-fixture-pass", "--output", resolve(forgedRoot, "caller.json")], isolatedEnvironment);
    assert.equal(selectedOutput.status, 2); assert.match(selectedOutput.stderr, /UNKNOWN_ARGUMENT:--output/); matrix.proof.push("caller-output-rejected", "direct-object-api-absent", "real-runner-evidence-accepted");

    const marker = resolve(root, git("rev-parse", "--git-path", "zd-kernel/fixtures/flaky-marker")); if (existsSync(marker)) unlinkSync(marker);
    const flakyPath = canonicalEvidencePath("kernel-fixture-flaky"); assert(!existsSync(flakyPath), "flaky fixture evidence already exists");
    const flakyPlan = { ...identity, requiredProofs: ["kernel-fixture-flaky"], requiredByKind: { unit: ["kernel-fixture-flaky"] } };
    const flaky = await withEnvironment(ciEnvironment, () => runRegisteredProof({ proofId: "kernel-fixture-flaky", plan: flakyPlan })); createdEvidence.push(flakyPath);
    assert.equal(flaky.status, "FLAKY_DETECTED"); assert.throws(() => validateEvidenceFile({ path: flakyPath, proofId: "kernel-fixture-flaky", plan: flakyPlan, environment: ciEnvironment }), /EVIDENCE_STALE|FLAKY/); matrix.proof.push("retry-pass-rejected");
  });
  rmSync(isolatedGit, { recursive: true, force: true }); tempRoots.splice(tempRoots.indexOf(isolatedGit), 1); isolatedRemoved = !existsSync(isolatedGit);
  assert(isolatedRemoved, "ISOLATED_STATE_FIXTURE_NOT_REMOVED");
  assert.deepEqual(snapshotDirectory(operationalDirectory), operationalBefore, "OPERATIONAL_SESSION_STORE_MUTATED_BY_TEST");
  matrix.state.push("operational-store-identical", "isolated-git-removed");

  for (const [text, expected, name] of [
    ["git status --short", CommandClass.READ_ONLY_ALLOWED, "git-read"], ["npm run kernel:test", CommandClass.REGISTERED_VERIFICATION_ALLOWED, "registered-test"],
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

  const repo = temp("kernel-git-");
  assert.equal(gitAt(repo, "init", "-q", "-b", "main").status, 0); gitAt(repo, "config", "user.email", "fixture@example.invalid"); gitAt(repo, "config", "user.name", "Kernel Fixture");
  writeFileSync(resolve(repo, "base.txt"), "base\n"); gitAt(repo, "add", "base.txt"); gitAt(repo, "commit", "-q", "-m", "base");
  const base = gitAt(repo, "rev-parse", "HEAD").stdout.trim(); gitAt(repo, "checkout", "-q", "-b", "feature"); writeFileSync(resolve(repo, "head.txt"), "head\n"); gitAt(repo, "add", "head.txt"); gitAt(repo, "commit", "-q", "-m", "head");
  const cleanFingerprint = dirtyFingerprint(repo), fingerprintPath = resolve(repo, "fingerprint.txt"); writeFileSync(fingerprintPath, "one\n"); const firstFingerprint = dirtyFingerprint(repo); writeFileSync(fingerprintPath, "two\n");
  assert.notEqual(cleanFingerprint, firstFingerprint); assert.notEqual(firstFingerprint, dirtyFingerprint(repo)); unlinkSync(fingerprintPath); matrix.state.push("content-sensitive-worktree");
  const head = gitAt(repo, "rev-parse", "HEAD").stdout.trim(), staleBase = gitAt(repo, "commit-tree", "HEAD^{tree}", "-m", "unrelated").stdout.trim();
  const fixture = resolve(repo, "gh-fixture.mjs");
  writeFileSync(fixture, `const a=process.argv.slice(2),s=process.env.SCENARIO;if(a[0]==='pr'&&a[1]==='view'){if(s==='no-pr'){console.error('no pull requests found');process.exit(1)}const base=s==='stale-base'?process.env.STALE_BASE:process.env.BASE_SHA;console.log(JSON.stringify({number:123,headRefOid:s==='wrong-head'?'0'.repeat(40):process.env.HEAD_SHA,baseRefOid:base,baseRefName:'main',url:'https://example.invalid/pr/123'}));process.exit(0)}if(s==='auth'){console.error('authentication network unavailable');process.exit(1)}if(s==='malformed'){console.log('{bad');process.exit(1)}const rows=s==='pending'?[{name:'preflight',state:'PENDING',bucket:'pending',link:''}]:s==='failed'?[{name:'preflight',state:'FAILURE',bucket:'fail',link:''}]:[{name:'preflight',state:'SUCCESS',bucket:'pass',link:''}];console.log(JSON.stringify(rows));process.exit(s==='pending'||s==='failed'?1:0);`);
  const gate = (scenario) => remoteGate({ cwd: repo, gh: (args) => command(repo, process.execPath, [fixture, ...args], { SCENARIO: scenario, HEAD_SHA: head, BASE_SHA: base, STALE_BASE: staleBase }) });
  assert.equal(gate("pending").status, "REMOTE_PENDING"); assert.equal(gate("failed").status, "REMOTE_FAILED"); assert.equal(gate("auth").status, "EXTERNAL_DEPENDENCY"); assert.equal(gate("success").status, "READY_TO_END"); assert.equal(gate("malformed").status, "REMOTE_FAILED"); assert.equal(gate("wrong-head").reason, "HEAD_MISMATCH"); assert.equal(gate("stale-base").reason, "BASE_NOT_ANCESTOR"); assert.equal(gate("no-pr").status, "PR_REQUIRED");
  process.env.stop_hook_active = "true"; assert.equal(gate("failed").status, "REMOTE_FAILED"); delete process.env.stop_hook_active;
  matrix.stopRemote.push("pending-nonzero", "failed-nonzero", "auth-external", "success", "malformed-closed", "head-mismatch", "stale-base", "no-pr", "active-flag-no-bypass");

  writeFileSync(resolve(repo, "old.mjs"), "export const oldValue=1;\n"); gitAt(repo, "add", "old.mjs"); gitAt(repo, "commit", "-q", "-m", "old"); gitAt(repo, "mv", "old.mjs", "new.mjs");
  const renameEntries = parseNameStatus(gitAt(repo, "diff", "--name-status", "-z", "--cached").stdout); assert.equal(renameEntries[0].status, "R"); assert.equal(renameEntries[0].oldPath, "old.mjs"); assert.equal(renameEntries[0].path, "new.mjs");
  assert.equal(gitAt(repo, "commit", "-q", "-m", "rename").status, 0); assert.equal(gitAt(repo, "rm", "-q", "new.mjs").status, 0); assert.equal(parseNameStatus(gitAt(repo, "diff", "--name-status", "-z", "--cached").stdout)[0].status, "D");
  for (const path of ["tools/unmapped-runner.mjs", "config/tool.ini", "db/queries.prisma"]) {
    const impact = compileImpact({ entries: [{ status: "A", path }], patch: "" }); assert.equal(impact.risk, "R3"); assert.equal(impact.writable, false); assert(impact.unresolved.some((item) => item.code === "UNMAPPED_PATH"));
  }
  const multiline = compileImpact({ entries: [{ status: "M", path: "src/lib/pipeline/contract.ts" }], patch: "+const result = supabase\n+  .from(\"leads\")\n+  .update({ status: \"won\" })\n+  .eq(\"id\", leadId);" });
  assert(multiline.changedAuthorities.includes("leads")); assert.equal(multiline.writable, true);
  const unknownAuthority = compileImpact({ entries: [{ status: "M", path: "src/lib/pipeline/contract.ts" }], patch: "+await supabase.from(\"unknown_fixture\").update({ value: 1 });" });
  assert(unknownAuthority.unresolved.some((item) => item.code === "AUTHORITY_UNRESOLVED")); assert.equal(unknownAuthority.writable, false);
  const prohibitedAuthority = compileImpact({ entries: [{ status: "M", path: "src/app/mappings/page.tsx" }], patch: "+await supabase.from(\"leads\").update({ status: \"won\" });" });
  assert(prohibitedAuthority.unresolved.some((item) => item.code === "PROHIBITED_WRITE_AUTHORITY"));
  const immutable = compileImpact({ entries: [{ status: "M", path: "supabase/migrations/051_fixture.sql" }], patch: "" }); assert(immutable.unresolved.some((item) => item.code === "IMMUTABLE_MIGRATION"));
  matrix.risk.push("nul-rename-delete", "sensitive-unmapped-r3", "multiline-write-detected", "unknown-authority", "prohibited-authority", "immutable-migration");

  const impact = { ...compileImpact({ entries: [{ status: "M", path: "scripts/engineering/kernel.test.mjs" }], patch: "" }), domains: ["engineering-control"], effects: ["ENGINEERING_CONTROL"], risk: "R3", unresolved: [], writable: true };
  const plan = compileProofPlan({ impact }); for (const kind of ["unit", "build", "postgres", "e2e"]) assert(plan.requiredByKind[kind].length, `domain proof missing ${kind}`);
  assert(compileProofPlan({ impact: { ...impact, domains: [], risk: "R3" } }).requiredProofs.length > 0);
  assert.throws(() => certifierModule.requireCanonicalEvidenceFiles({ requiredProofs: ["missing-required-proof"] }), /EVIDENCE_FILE_SET_MISMATCH|EVIDENCE_DIRECTORY_MISSING/);
  matrix.proof.push("missing-required-proof-rejected");
  assert.equal(containsAssertionWeakening(`npx jest --update${"Snapshot"}`), true); assert.equal(containsAssertionWeakening("npx jest --runInBand"), false);
  const isolated = safeEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://production.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-invalid", [["SUPABASE", "SERVICE_ROLE_KEY"].join("_")]: "synthetic-invalid", KEEP: "yes" }); assert.deepEqual(isolated, { KEEP: "yes" });
  assert.equal(revalidateCandidate({ path: "scripts/engineering/fixtures/missing-candidate.mjs", contentHash: "0".repeat(64) }), false);

  const index = buildSourceIndex({ writeCache: false }), criticalClaim = [{ id: "FIXTURE_CRITICAL", severity: "CRITICAL" }];
  const missingSemantic = executeRegressionCases({ cases: [{ id: "fixture-semantic", kind: "semantic", executorId: "missing", requiredClaims: ["FIXTURE_CRITICAL"], proofRefs: ["kernel-fixture-pass"] }], claims: criticalClaim, index });
  assert.match(missingSemantic.results[0].failureReason, /CASE_EXECUTOR_MISSING/); assert.equal(missingSemantic.coverageFailures.length, 1);
  const wrongBlocker = executeRegressionCases({ cases: [{ id: "platform-snapshot-blocker", kind: "blocker", expectedBlocker: "FALSE_BLOCKER", requiredClaims: ["FIXTURE_CRITICAL"] }], claims: criticalClaim, index });
  assert.equal(wrongBlocker.results[0].pass, false); assert.match(wrongBlocker.results[0].failureReason, /BLOCKER:SOURCE_SNAPSHOT_UNBOUND/);
  const missingControl = executeRegressionCases({ cases: [{ id: "fixture-control", kind: "control", executorId: "missing", requiredClaims: ["FIXTURE_CRITICAL"] }], claims: criticalClaim, index }); assert.match(missingControl.results[0].failureReason, /CASE_EXECUTOR_MISSING/);
  const unknownKind = executeRegressionCases({ cases: [{ id: "fixture-unknown", kind: "unknown", requiredClaims: ["FIXTURE_CRITICAL"] }], claims: criticalClaim, index }); assert.match(unknownKind.results[0].failureReason, /CASE_EXECUTOR_MISSING/);
  assert.throws(() => validateCaseResult({ caseId: "zero", executed: true, assertionCount: 0, pass: true }), /CASE_ZERO_ASSERTIONS/);
  matrix.regression.push("semantic-proofref-only-rejected", "false-blocker-rejected", "control-executor-missing", "unknown-kind-rejected", "zero-assertions-rejected", "unexecuted-critical-claim-rejected");

  const productChanges = git("diff", "--name-only", "origin/main", "--", "src").split(/\r?\n/).filter((path) => path && !path.includes("/__tests__/"));
  const migrationChanges = git("diff", "--name-only", "origin/main", "--", "supabase/migrations").split(/\r?\n/).filter((path) => path.endsWith(".sql"));
  assert.deepEqual(productChanges, []); assert.deepEqual(migrationChanges, []);
  console.log(JSON.stringify({ code: "KERNEL_ADVERSARIAL_MATRIX_PASS", operationalStateBefore: operationalBefore, operationalStateAfter: snapshotDirectory(operationalDirectory), matrix }));
} finally {
  for (const path of createdEvidence) if (existsSync(path)) rmSync(path, { force: true });
  for (const path of tempRoots) if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}
