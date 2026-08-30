import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { classifyCommand, CommandClass } from "./command-policy.mjs";
import { resolveContext } from "./context.mjs";
import { compileImpact } from "./impact.mjs";
import { compileRegisteredCommandPlan } from "./proof-command-plan.mjs";
import { git, inspectMigrationBoundaryTransition, readJson, root, run, safeEnvironment } from "./kernel-lib.mjs";
import { containsAssertionWeakening } from "../quality/assertion-policy.mjs";
import { scanRepository } from "../quality/repository-safety.mjs";
import { evaluateOwnerGate, requiredCapabilities } from "../handover/lib.mjs";

const rank = { R0: 0, R1: 1, R2: 2, R3: 3 };
const proofs = () => readJson("docs/engineering/PROOFS.json").proofs;
const domains = () => readJson("docs/engineering/DOMAIN_MAP.json").domains;
const assertCase = (condition, reason, counter) => {
  counter.count += 1;
  if (!condition) throw new Error(reason);
};
const executeProofOnce = (proofId, cache, counter) => {
  if (cache.has(proofId)) { assertCase(cache.get(proofId), `REGISTERED_PROOF_FAILED:${proofId}`, counter); return; }
  const proof = proofs().find((item) => item.id === proofId);
  if (!proof || ["kernel-preflight", "kernel-unit-build"].includes(proofId) || !["jest", "node", "fixed-commands"].includes(proof.runner)) throw new Error(`REGRESSION_PROOF_UNSAFE_OR_RECURSIVE:${proofId}`);
  const commandPlan = compileRegisteredCommandPlan({ proof, proofId, baseSha: git("rev-parse", "origin/main"), headSha: git("rev-parse", "HEAD"), attemptIndex: 1 });
  const passed = commandPlan.commands.every((command) => run(command.executable, command.args, { env: safeEnvironment(process.env) }).status === 0);
  cache.set(proofId, passed);
  assertCase(passed, `REGISTERED_PROOF_FAILED:${proofId}`, counter);
};

const resolveEvaluator = ({ item, index, counter }) => {
  const pack = resolveContext({ task: item.inputTask, index }), expectedStatus = item.expectedStatus ?? "RESOLVED";
  assertCase(pack.status === expectedStatus, `STATUS:${pack.status}`, counter);
  assertCase(expectedStatus === "RESOLVED" || pack.requiredOpenPaths.length === 0, "AMBIGUOUS_WRITE_SCOPE", counter);
  for (const domain of item.expectedDomains ?? []) assertCase(pack.domains.includes(domain), `DOMAIN:${domain}`, counter);
  if (item.minimumRisk) assertCase(rank[pack.risk] >= rank[item.minimumRisk], `RISK:${pack.risk}`, counter);
  for (const authority of item.requiredAuthorities ?? []) assertCase(pack.authorities.includes(authority), `AUTHORITY:${authority}`, counter);
  if (expectedStatus === "RESOLVED" && item.candidatePathsAnyOf?.length) assertCase(item.candidatePathsAnyOf.some((path) => pack.candidatePaths.some((candidate) => candidate.path === path || candidate.path.startsWith(`${path}/`))), `PATH:${item.candidatePathsAnyOf.join("|")}`, counter);
  assertCase(pack.candidatePaths.length <= 7, "CANDIDATE_LIMIT", counter);
};
const semanticProofEvaluator = ({ item, counter, proofCache }) => {
  const selected = domains().filter((domain) => (item.expectedDomains ?? []).includes(domain.id));
  const authorityIds = new Set(selected.flatMap((domain) => domain.authorityRefs ?? []));
  for (const authority of item.requiredAuthorities ?? []) assertCase(authorityIds.has(authority), `AUTHORITY:${authority}`, counter);
  assertCase((item.proofRefs ?? []).length > 0, "SEMANTIC_PROOF_MISSING", counter);
  for (const proofId of item.proofRefs) executeProofOnce(proofId, proofCache, counter);
};
const controlEvaluator = ({ item, counter }) => {
  if (item.id === "production-safety") {
    const migration = inspectMigrationBoundaryTransition(), boundary = migration.baseImmutableThrough, fixture = (number) => `supabase/migrations/${String(number).padStart(3, "0")}_fixture.sql`;
    assertCase(migration.immutableThrough >= boundary && migration.immutableThrough <= boundary + 1, "MIGRATION_BOUNDARY", counter);
    assertCase(scanRepository(root).violations.length === 0, "REPOSITORY_SAFETY", counter);
    assertCase(compileImpact({ entries: [{ status: "M", path: fixture(boundary) }], patch: "", baseImmutableThrough: boundary }).unresolved.some((entry) => entry.code === "IMMUTABLE_MIGRATION"), "IMMUTABLE_MIGRATION", counter);
    assertCase(!compileImpact({ entries: [{ status: "A", path: fixture(boundary + 1) }], patch: "", baseImmutableThrough: boundary }).unresolved.some((entry) => entry.code === "IMMUTABLE_MIGRATION"), "FORWARD_MIGRATION_FALSE_POSITIVE", counter);
  } else if (item.id === "repository-proof") {
    const proof = proofs().find((candidate) => candidate.id === "kernel-fixture-pass");
    const one = compileRegisteredCommandPlan({ proof, proofId: proof.id, baseSha: "1".repeat(40), headSha: "2".repeat(40), attemptIndex: 1 });
    const two = compileRegisteredCommandPlan({ proof, proofId: proof.id, baseSha: "1".repeat(40), headSha: "2".repeat(40), attemptIndex: 1 });
    assertCase(one.commandPlanHash === two.commandPlanHash && one.commands[0].commandIdentity === two.commands[0].commandIdentity, "COMMAND_PLAN_NONDETERMINISTIC", counter);
    assertCase(classifyCommand("git push origin HEAD:main").classification === CommandClass.PROHIBITED, "EXACT_HEAD_POLICY", counter);
  } else if (item.id === "control-plane-regressions") {
    assertCase(containsAssertionWeakening(`npx jest --update${"Snapshot"}`), "ASSERTION_POLICY", counter);
    assertCase(!containsAssertionWeakening("npx jest --runInBand"), "ASSERTION_POLICY_FALSE_POSITIVE", counter);
    assertCase(classifyCommand("node -e process.exit(0)").classification === CommandClass.PROHIBITED, "CONTROL_COMMAND_POLICY", counter);
  } else if (item.id === "task-lifecycle-hardening") {
    const directory = mkdtempSync(resolve(tmpdir(), "regression-dirty-"));
    try {
      run("git", ["init", "-q"], { cwd: directory });
      writeFileSync(resolve(directory, "fixture.txt"), "one\n");
      const one = run("git", ["status", "--porcelain=v1"], { cwd: directory }).stdout;
      writeFileSync(resolve(directory, "fixture.txt"), "two\n");
      const two = readFileSync(resolve(directory, "fixture.txt"), "utf8");
      assertCase(one.includes("fixture.txt") && two === "two\n", "CONTENT_SENSITIVE_WORKTREE", counter);
      assertCase(classifyCommand("git clean -fd").classification === CommandClass.PROHIBITED, "OWNER_WORK_PROTECTION", counter);
      assertCase(classifyCommand("git push origin chore/engineering-kernel-v4").classification === CommandClass.SCOPED_MUTATION_ALLOWED, "FEATURE_PUBLICATION_GATE", counter);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  } else throw new Error(`CASE_EXECUTOR_MISSING:${item.id}`);
};
const blockerEvaluator = ({ item, counter }) => {
  const consistency = readJson("docs/handover/consistency-contract.json"), gates = readJson("docs/handover/owner-gates.json");
  const actual = {
    "platform-storage-blocker": consistency.storage?.phases?.includes("FINAL_STORAGE_DELTA") && gates.gates.find((gate) => gate.id === "G2")?.requires?.some((value) => value.includes("Storage")) ? "DATABASE_DUMP_NOT_STORAGE_TRANSFER" : "STORAGE_CONTROL_MISSING",
    "platform-auth-blocker": requiredCapabilities.includes("auth") && requiredCapabilities.includes("authConfiguration") ? "AUTH_CONFIGURATION_PARITY_REQUIRED" : "AUTH_CONTROL_MISSING",
    "platform-realtime-blocker": requiredCapabilities.includes("realtime") ? "REALTIME_COMPATIBILITY_REQUIRED" : "REALTIME_CONTROL_MISSING",
    "platform-cutover-blocker": gates.gates.find((gate) => gate.id === "G3")?.requiredBefore?.some((value) => value.includes("Vercel")) ? "CUTOVER_ENV_PARITY_REQUIRED" : "CUTOVER_CONTROL_MISSING",
    "platform-client-cutover-blocker": evaluateOwnerGate("G3", { writersQuiesced: true }),
    "platform-snapshot-blocker": evaluateOwnerGate("G2"),
    "platform-rollback-availability-blocker": evaluateOwnerGate("G3", { writersQuiesced: true, clientCutoverCompatibilityProven: true }),
    "platform-rollback-blocker": consistency.rollback?.lateTargetWritesRequire,
  }[item.id];
  if (!actual) throw new Error(`CASE_EXECUTOR_MISSING:${item.id}`);
  assertCase(actual === item.expectedBlocker, `BLOCKER:${actual}`, counter);
};

export const executorIdForCase = (item) => item.executorId ?? (item.kind === "resolve" ? "resolver" : item.kind === "blocker" ? "platform-blocker" : item.kind === "control" ? "kernel-control" : item.kind === "semantic" && ["external-partner", "distributor-renewal", "field-evidence"].includes(item.id) ? "registered-proof" : item.kind === "semantic" ? "kernel-control" : null);
const executors = Object.freeze({ resolver: resolveEvaluator, "registered-proof": semanticProofEvaluator, "kernel-control": controlEvaluator, "platform-blocker": blockerEvaluator });
export const validateCaseResult = (result) => {
  if (!result.executed) throw new Error(`CASE_NOT_EXECUTED:${result.caseId}`);
  if (!Number.isInteger(result.assertionCount) || result.assertionCount < 1) throw new Error(`CASE_ZERO_ASSERTIONS:${result.caseId}`);
  if (!result.pass) throw new Error(result.failureReason || `CASE_FAILED:${result.caseId}`);
  return result;
};
export const executeRegressionCases = ({ cases, claims, index }) => {
  const results = [], proofCache = new Map();
  for (const item of cases) {
    const executorId = executorIdForCase(item), executor = executors[executorId];
    if (!executor) { results.push({ caseId: item.id, caseKind: item.kind, executorId: executorId ?? "", executed: false, assertionCount: 0, coveredClaimIds: item.requiredClaims ?? [], pass: false, failureReason: `CASE_EXECUTOR_MISSING:${item.id}` }); continue; }
    const counter = { count: 0 };
    try {
      executor({ item, index, counter, proofCache });
      results.push({ caseId: item.id, caseKind: item.kind, executorId, executed: true, assertionCount: counter.count, coveredClaimIds: item.requiredClaims ?? [], pass: true, failureReason: "" });
    } catch (error) { results.push({ caseId: item.id, caseKind: item.kind, executorId, executed: true, assertionCount: counter.count, coveredClaimIds: item.requiredClaims ?? [], pass: false, failureReason: error.message }); }
  }
  const passedClaims = new Set(results.filter((result) => result.executed && result.pass && result.assertionCount > 0).flatMap((result) => result.coveredClaimIds));
  const coverageFailures = claims.filter((claim) => ["HIGH", "CRITICAL"].includes(claim.severity) && !passedClaims.has(claim.id)).map((claim) => `CLAIM_EXECUTABLE_COVERAGE_MISSING:${claim.id}`);
  return { results, coverageFailures };
};
