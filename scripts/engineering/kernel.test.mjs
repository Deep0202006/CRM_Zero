import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileImpact, parseNameStatus } from "./impact.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { requireEvidenceFiles, validateEvidenceItem } from "./proof-certify-ci.mjs";
import { runRegisteredProof } from "./proof-runner.mjs";
import { revalidateCandidate } from "./context.mjs";
import { remoteGate } from "./hooks/stop.mjs";
import { beginExternalTask, compareAndSwap, loadState, requireContinuation, sessionPath } from "./hooks/state-store.mjs";
import { dirtyFingerprint, git, root, safeEnvironment } from "./kernel-lib.mjs";
import { containsAssertionWeakening } from "../quality/assertion-policy.mjs";

const matrix = { state: [], risk: [], proof: [], stopRemote: [] };
const tempRoots = [];
const testSessions = [];
const temp = (prefix) => { const path = mkdtempSync(resolve(tmpdir(), prefix)); tempRoots.push(path); return path; };
const command = (cwd, file, args, env, input) => spawnSync(file, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, input });
const gitAt = (cwd, ...args) => command(cwd, "git", args);
try {
  const session = `kernel-test-${randomUUID()}`;
  testSessions.push(session);
  const first = beginExternalTask(session, "first external task");
  compareAndSwap(session, first.revision, { ...first, evidence: [{ proofId: "old" }], failureSignatures: ["old"], resolution: { status: "RESOLVED" }, progressSignature: "old" });
  const second = beginExternalTask(session, "second external task");
  assert.notEqual(second.taskId, first.taskId);
  assert.deepEqual(second.evidence, []); assert.deepEqual(second.failureSignatures, []); assert.equal(second.resolution, undefined); assert.equal(second.progressSignature, undefined);
  assert.equal(requireContinuation(session, second.taskId).taskId, second.taskId);
  assert.throws(() => requireContinuation(session, first.taskId), /CONTINUATION_TASK_MISMATCH/);
  const expandHook = command(root, process.execPath, ["scripts/engineering/hooks/user-prompt.mjs"], undefined, JSON.stringify({ session_id: session, prompt: `KERNEL_SCOPE_EXPAND|taskId=${second.taskId}|path=scripts/engineering/context.mjs|task=inspect exact context resolver` }));
  assert.equal(expandHook.status, 0); assert.equal(loadState(session).scopeRevision, 1); assert.equal(loadState(session).resolution.status, "RESOLVED");
  matrix.state.push("external-reset", "exact-continuation", "evidence-backed-scope-expansion");

  const staleSession = `kernel-test-${randomUUID()}`, stale = loadState(staleSession), stateModuleUrl = pathToFileURL(resolve(root, "scripts/engineering/hooks/state-store.mjs")).href;
  testSessions.push(staleSession);
  const code = `import {compareAndSwap} from ${JSON.stringify(stateModuleUrl)};try{compareAndSwap(process.argv[1],Number(process.argv[2]),{status:'IMPLEMENTATION_IN_PROGRESS'});process.exit(0)}catch(e){console.error(e.message);process.exit(2)}`;
  const children = [0, 1].map(() => new Promise((done) => { const child = spawn(process.execPath, ["--input-type=module", "-e", code, staleSession, String(stale.revision)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }); let stderr = ""; child.stderr.on("data", (chunk) => stderr += chunk); child.on("exit", (status) => done({ status, stderr })); }));
  const writes = await Promise.all(children);
  assert.deepEqual(writes.map((item) => item.status).sort(), [0, 2]);
  assert(writes.some((item) => item.stderr.includes("STATE_STALE_WRITE")));
  matrix.state.push("concurrent-stale-rejected");

  const corruptSession = `kernel-test-${randomUUID()}`, corruptPath = sessionPath(corruptSession);
  testSessions.push(corruptSession);
  mkdirSync(dirname(corruptPath), { recursive: true }); writeFileSync(corruptPath, "{interrupted");
  assert.throws(() => loadState(corruptSession), /STATE_CORRUPT_PRESERVED/);
  assert(readdirSync(dirname(corruptPath)).some((name) => name.startsWith(`${corruptSession}.json.corrupt-`)));
  matrix.state.push("corrupt-preserved-fail-closed");

  const hookSession = `kernel-test-${randomUUID()}`; testSessions.push(hookSession);
  const startHook = command(root, process.execPath, ["scripts/engineering/hooks/session-start.mjs"], undefined, JSON.stringify({ session_id: hookSession }));
  assert.equal(startHook.status, 0);
  const postHook = command(root, process.execPath, ["scripts/engineering/hooks/post-tool.mjs"], undefined, JSON.stringify({ session_id: hookSession, tool_name: "fixture", tool_input: { command: "synthetic-private-input" }, tool_response: { exit_code: 9, stdout: "synthetic-private-output", stderr: "synthetic-private-error" } }));
  assert.equal(postHook.status, 0);
  const postState = loadState(hookSession), storedState = readFileSync(sessionPath(hookSession), "utf8");
  assert.equal(postState.failureSignatures[0].length, 64); assert(!storedState.includes("synthetic-private"));
  matrix.state.push("hook-schema-valid", "failure-output-hashed-only");

  const repo = temp("kernel-git-");
  assert.equal(gitAt(repo, "init", "-q", "-b", "main").status, 0);
  gitAt(repo, "config", "user.email", "fixture@example.invalid"); gitAt(repo, "config", "user.name", "Kernel Fixture");
  writeFileSync(resolve(repo, "base.txt"), "base\n"); gitAt(repo, "add", "base.txt"); gitAt(repo, "commit", "-q", "-m", "base");
  const base = gitAt(repo, "rev-parse", "HEAD").stdout.trim(); gitAt(repo, "checkout", "-q", "-b", "feature");
  writeFileSync(resolve(repo, "head.txt"), "head\n"); gitAt(repo, "add", "head.txt"); gitAt(repo, "commit", "-q", "-m", "head");
  const cleanFingerprint = dirtyFingerprint(repo), fingerprintPath = resolve(repo, "fingerprint.txt");
  writeFileSync(fingerprintPath, "one\n"); const firstFingerprint = dirtyFingerprint(repo); writeFileSync(fingerprintPath, "two\n");
  assert.notEqual(cleanFingerprint, firstFingerprint); assert.notEqual(firstFingerprint, dirtyFingerprint(repo)); unlinkSync(fingerprintPath);
  matrix.state.push("content-sensitive-worktree");
  const head = gitAt(repo, "rev-parse", "HEAD").stdout.trim(), staleBase = gitAt(repo, "commit-tree", "HEAD^{tree}", "-m", "unrelated").stdout.trim();
  const fixture = resolve(repo, "gh-fixture.mjs");
  writeFileSync(fixture, `const a=process.argv.slice(2),s=process.env.SCENARIO;if(a[0]==='pr'&&a[1]==='view'){if(s==='no-pr'){console.error('no pull requests found');process.exit(1)}const base=s==='stale-base'?process.env.STALE_BASE:process.env.BASE_SHA;console.log(JSON.stringify({number:123,headRefOid:s==='wrong-head'?'0'.repeat(40):process.env.HEAD_SHA,baseRefOid:base,baseRefName:'main',url:'https://example.invalid/pr/123'}));process.exit(0)}if(s==='auth'){console.error('authentication network unavailable');process.exit(1)}if(s==='malformed'){console.log('{bad');process.exit(1)}const rows=s==='pending'?[{name:'preflight',state:'PENDING',bucket:'pending',link:''}]:s==='failed'?[{name:'preflight',state:'FAILURE',bucket:'fail',link:''}]:[{name:'preflight',state:'SUCCESS',bucket:'pass',link:''}];console.log(JSON.stringify(rows));process.exit(s==='pending'||s==='failed'?1:0);`);
  const gate = (scenario) => remoteGate({ cwd: repo, gh: (args) => command(repo, process.execPath, [fixture, ...args], { SCENARIO: scenario, HEAD_SHA: head, BASE_SHA: base, STALE_BASE: staleBase }) });
  assert.equal(gate("pending").status, "REMOTE_PENDING");
  assert.equal(gate("failed").status, "REMOTE_FAILED");
  assert.equal(gate("auth").status, "EXTERNAL_DEPENDENCY");
  assert.equal(gate("success").status, "READY_TO_END");
  assert.equal(gate("malformed").status, "REMOTE_FAILED");
  assert.equal(gate("wrong-head").reason, "HEAD_MISMATCH");
  assert.equal(gate("stale-base").reason, "BASE_NOT_ANCESTOR");
  assert.equal(gate("no-pr").status, "PR_REQUIRED");
  process.env.stop_hook_active = "true"; assert.equal(gate("failed").status, "REMOTE_FAILED"); delete process.env.stop_hook_active;
  matrix.stopRemote.push("pending-nonzero", "failed-nonzero", "auth-external", "success", "malformed-closed", "head-mismatch", "stale-base", "no-pr", "active-flag-no-bypass");

  const runPreTool = (toolInput) => {
    const hookSession = `kernel-test-${randomUUID()}`; testSessions.push(hookSession);
    return command(root, process.execPath, ["scripts/engineering/hooks/pre-tool.mjs"], undefined, JSON.stringify({ session_id: hookSession, tool_name: "exec_command", tool_input: toolInput }));
  };
  const removedPath = runPreTool({ cmd: "node check.js" });
  assert.equal(removedPath.status, 0); assert.match(removedPath.stdout, /SAFETY_CONFLICT:PROHIBITED_COMMAND/);
  const indirectRemovedPath = runPreTool({ cmd: "npm exec -- node scripts/seed-production-users.js" });
  assert.equal(indirectRemovedPath.status, 0); assert.match(indirectRemovedPath.stdout, /SAFETY_CONFLICT:PROHIBITED_COMMAND/);
  const oldMigration = runPreTool({ cmd: "git add supabase/migrations/051_fixture.sql" });
  assert.equal(oldMigration.status, 0); assert.match(oldMigration.stdout, /SAFETY_CONFLICT:IMMUTABLE_MIGRATION/);
  const pathlessMutation = runPreTool({ cmd: "Set-Content -LiteralPath $targetPath -Value fixture" });
  assert.equal(pathlessMutation.status, 0); assert.match(pathlessMutation.stdout, /SAFETY_CONFLICT:SCOPE_OR_HASH/);
  const broadStage = runPreTool({ cmd: "git add -A" });
  assert.equal(broadStage.status, 0); assert.match(broadStage.stdout, /SAFETY_CONFLICT:PROHIBITED_COMMAND/);
  const readOnlyCloud = runPreTool({ cmd: "docker --version" });
  assert.equal(readOnlyCloud.status, 0); assert.equal(readOnlyCloud.stdout, "");
  assert.equal(revalidateCandidate({ path: "scripts/engineering/fixtures/missing-candidate.mjs", contentHash: "0".repeat(64) }), false);
  matrix.risk.push("removed-path-pretool", "indirect-removed-path-pretool", "migration-pretool", "pathless-mutation-closed", "broad-stage-blocked", "read-only-cloud-allowed", "missing-candidate-invalid");

  writeFileSync(resolve(repo, "old.mjs"), "export const oldValue=1;\n"); gitAt(repo, "add", "old.mjs"); gitAt(repo, "commit", "-q", "-m", "old"); gitAt(repo, "mv", "old.mjs", "new.mjs");
  const renameEntries = parseNameStatus(gitAt(repo, "diff", "--name-status", "-z", "--cached").stdout);
  assert.equal(renameEntries[0].status, "R"); assert.equal(renameEntries[0].oldPath, "old.mjs"); assert.equal(renameEntries[0].path, "new.mjs");
  assert.equal(gitAt(repo, "commit", "-q", "-m", "rename").status, 0);
  assert.equal(gitAt(repo, "rm", "-q", "new.mjs").status, 0);
  const deleteEntries = parseNameStatus(gitAt(repo, "diff", "--name-status", "-z", "--cached").stdout);
  assert.equal(deleteEntries[0].status, "D");
  const unknown = compileImpact({ entries: [{ status: "A", path: "tools/unmapped-runner.mjs" }], patch: "" });
  assert.equal(unknown.risk, "R3"); assert(unknown.unresolved.some((item) => item.code === "UNMAPPED_PATH"));
  const floor = compileImpact({ entries: [{ status: "M", path: "src/lib/receivables/domain.ts" }], patch: "" });
  assert.equal(floor.risk, "R3");
  const immutable = compileImpact({ entries: [{ status: "M", path: "supabase/migrations/051_fixture.sql" }], patch: "" });
  assert(immutable.unresolved.some((item) => item.code === "IMMUTABLE_MIGRATION"));
  assert.equal(containsAssertionWeakening(`npx jest --update${"Snapshot"}`), true);
  assert.equal(containsAssertionWeakening("npx jest --runInBand"), false);
  const isolated = safeEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://production.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-invalid", [["SUPABASE", "SERVICE_ROLE_KEY"].join("_")]: "synthetic-invalid", KEEP: "yes" });
  assert.deepEqual(isolated, { KEEP: "yes" });
  assert.equal(safeEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key" }).NEXT_PUBLIC_SUPABASE_URL, "https://e2e.supabase.co");
  matrix.risk.push("nul-rename-delete", "unknown-r3", "domain-floor", "immutable-migration", "assertion-weakening", "proof-environment-isolation");

  const impact = { ...compileImpact({ entries: [{ status: "M", path: "scripts/engineering/kernel.test.mjs" }], patch: "" }), domains: ["engineering-control"], effects: ["ENGINEERING_CONTROL"], risk: "R3", unresolved: [], writable: true };
  const plan = compileProofPlan({ impact });
  for (const kind of ["unit", "build", "postgres", "e2e"]) assert(plan.requiredByKind[kind].length, `domain proof missing ${kind}`);
  const fake = command(root, process.execPath, ["scripts/engineering/proof-runner.mjs", "--proof", "kernel-fixture-pass", "--evidence", "fake.json"]);
  assert.equal(fake.status, 2); assert(fake.stderr.includes("UNKNOWN_ARGUMENT"));
  assert.throws(() => compileProofPlan({ impact: { ...impact, domains: [], risk: "R3" } }), /PROOF_UNMAPPED/);
  const identity = { ...impact, requiredProofs: ["kernel-fixture-pass"], requiredByKind: { unit: ["kernel-fixture-pass"] }, notRequiredKinds: [], planHash: "a".repeat(64), impactHash: "b".repeat(64), headSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}"), baseSha: git("rev-parse", "origin/main") };
  const pass = runRegisteredProof({ proofId: "kernel-fixture-pass", plan: identity, output: resolve(temp("kernel-evidence-"), "pass.json") });
  assert.equal(pass.status, "PASS");
  assert.throws(() => validateEvidenceItem({ ...pass, attempts: [[{ ...pass.attempts[0][0], exitCode: 1 }]] }, "kernel-fixture-pass", identity), /EVIDENCE_INCOMPLETE/);
  const marker = resolve(root, git("rev-parse", "--git-path", "zd-kernel/fixtures/flaky-marker")); if (existsSync(marker)) unlinkSync(marker);
  const flakyPlan = { ...identity, requiredProofs: ["kernel-fixture-flaky"], requiredByKind: { unit: ["kernel-fixture-flaky"] } };
  const flaky = runRegisteredProof({ proofId: "kernel-fixture-flaky", plan: flakyPlan, output: resolve(temp("kernel-evidence-"), "flaky.json") });
  assert.equal(flaky.status, "FLAKY_DETECTED");
  for (const key of ["headSha", "treeSha", "baseSha", "dirtyFingerprint", "impactHash", "planHash"]) assert.throws(() => validateEvidenceItem({ ...pass, [key]: "0".repeat(64) }, "kernel-fixture-pass", identity), /EVIDENCE_STALE/);
  assert.throws(() => requireEvidenceFiles({ requiredProofs: ["missing"] }, temp("kernel-missing-")), /EVIDENCE_MISSING/);
  matrix.proof.push("domain-required-without-effect", "unmapped-required-proof", "fake-pass-rejected", "actual-pass", "fabricated-exit-rejected", "flaky-detected", "stale-identities", "missing-artifact");

  const productChanges = git("diff", "--name-only", "origin/main", "--", "src").split(/\r?\n/).filter((path) => path && !path.includes("/__tests__/"));
  const migrationChanges = git("diff", "--name-only", "origin/main", "--", "supabase/migrations").split(/\r?\n/).filter((path) => path.endsWith(".sql"));
  assert.deepEqual(productChanges, []); assert.deepEqual(migrationChanges, []);
  assert(readFileSync(resolve(root, ".github/CODEOWNERS"), "utf8").includes("scripts/engineering/** @Deep0202006"));
  console.log(JSON.stringify({ code: "KERNEL_ADVERSARIAL_MATRIX_PASS", matrix }));
} finally {
  for (const path of tempRoots) rmSync(path, { recursive: true, force: true });
  for (const session of testSessions) {
    const path = sessionPath(session), directory = dirname(path);
    if (existsSync(directory)) for (const name of readdirSync(directory)) if (name.startsWith(`${session}.`)) rmSync(resolve(directory, name), { force: true });
  }
}
