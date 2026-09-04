import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildSourceIndex } from "./source-index.mjs";
import { resolveContext } from "./context.mjs";
import { deriveAssumptions, readTaskExperience, recordMetricEvent, selectExperience, serializeSessionContext, upsertIncident, writeTaskExperience } from "./experience.mjs";
import { validateOwnerLedgerFastPath } from "./impact.mjs";
import { compileRegisteredCommandPlan, proofDefinitionHash, proofInputIdentity, proofRunnerIdentity, validateCommandPlan, validateProofCiParity } from "./proof-command-plan.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { detectPostgresBackend, executeAttempt } from "./proof-runner.mjs";
import { evaluateReuseCandidate, proveAssumptions, relatedTestSelection } from "./readiness.mjs";
import { environmentPolicyHash, readJson, root, sha256, validateMigrationLedger } from "./kernel-lib.mjs";

const sha = (letter) => letter.repeat(40), hex = (letter) => letter.repeat(64), registry = readJson("docs/engineering/PROOFS.json"), proofs = registry.proofs;
const syntheticImpact = ({ path, domains, effects, writable = true }) => ({ schemaVersion: 3, baseSha: sha("a"), headSha: sha("b"), treeSha: sha("c"), dirtyFingerprint: hex("0"), impactHash: sha256(path), changes: [{ status: "M", path, domains, effects, risk: "R3", unknown: !writable }], changedPaths: [path], domains, effects, changedAuthorities: [], contextDomainHints: [], risk: "R3", unresolved: writable ? [] : [{ code: "UNMAPPED_PATH", path }], writable, writeOperations: [], readOperations: [], unknownOperations: [], removedOperations: [], writeResolutions: [], sharedResources: [], functionAuthorities: [], registryReconciliations: [] });

const uiPlan = compileProofPlan({ impact: syntheticImpact({ path: "src/app/call-logs/page.tsx", domains: ["calls"], effects: ["UI", "TYPESCRIPT", "RUNTIME_BUILD"] }) });
for (const id of ["control-postgres-matrix", "control-e2e-matrix", "product-054-postgres"]) assert(!uiPlan.requiredProofs.includes(id));
assert.equal(uiPlan.requiredByKind.postgres.length, 0); assert(uiPlan.requiredProofs.includes("calls-unit"));
const dbPlan = compileProofPlan({ impact: syntheticImpact({ path: "scripts/receivables-db/fixture.sql", domains: ["receivables"], effects: ["DATABASE", "SCHEMA"] }) });
assert.deepEqual(dbPlan.requiredByKind.postgres, ["receivables-postgres"]); assert.equal(dbPlan.requiredByKind.e2e.length, 0);
const ledgerPlan = compileProofPlan({ impact: syntheticImpact({ path: "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json", domains: ["engineering-control"], effects: ["OWNER_LEDGER_TRANSITION"] }) });
assert.deepEqual(ledgerPlan.requiredProofs, ["kernel-preflight", "owner-ledger-invariant"]); assert(ledgerPlan.reuseEligibleProofs.includes("product-054-postgres"));
assert.throws(() => compileProofPlan({ impact: syntheticImpact({ path: "infra/unknown.yaml", domains: [], effects: ["CONFIGURATION"], writable: false }) }), /IMPACT_UNRESOLVED/);

const duplicate = { ...proofs.find((proof) => proof.id === "receivables-postgres"), id: "duplicate-receivables" };
assert.throws(() => validateCommandPlan({ plan: { ...dbPlan, requiredProofs: ["receivables-postgres", duplicate.id] }, proofs: [...proofs, duplicate] }), /DUPLICATE_EXPENSIVE_COMMAND_PLAN_FORBIDDEN/);

const callsProof = proofs.find((proof) => proof.id === "calls-unit"), input = proofInputIdentity(callsProof), now = new Date().toISOString(), source = { status: "PASS", baseSha: sha("a"), headSha: sha("b"), endedAt: now, proofDefinitionHash: proofDefinitionHash(callsProof), proofInputHash: input.proofInputHash, runnerIdentity: proofRunnerIdentity(), environmentPolicyHash: environmentPolicyHash(), evidencePayloadHash: hex("d") }, reusePlan = { baseSha: sha("a"), headSha: sha("c") }, cleanIncrement = { writable: true, changes: [{ unknown: false }], impactHash: hex("e") };
assert.equal(evaluateReuseCandidate({ proof: callsProof, source, plan: reusePlan, incrementalImpact: cleanIncrement, incidents: [], isAncestor: () => true }).reusable, true);
for (const candidate of [{ ...source, status: "FAIL" }, { ...source, status: "FLAKY_DETECTED" }, { ...source, runnerIdentity: hex("0") }, { ...source, proofInputHash: hex("0") }]) assert.equal(evaluateReuseCandidate({ proof: callsProof, source: candidate, plan: reusePlan, incrementalImpact: cleanIncrement, incidents: [], isAncestor: () => true }).reusable, false);
assert.equal(evaluateReuseCandidate({ proof: callsProof, source, plan: reusePlan, incrementalImpact: cleanIncrement, incidents: [], isAncestor: () => false }).reusable, false);
assert.equal(evaluateReuseCandidate({ proof: callsProof, source, plan: reusePlan, incrementalImpact: { ...cleanIncrement, writable: false, changes: [{ unknown: true }] }, incidents: [], isAncestor: () => true }).reusable, false);
assert(proofInputIdentity(proofs.find((proof) => proof.id === "kernel-unit-build")).paths.includes("package-lock.json"));
assert(proofInputIdentity(proofs.find((proof) => proof.id === "product-054-postgres")).paths.includes("supabase/migrations/054_creator_updates_billed_erp_payment.sql"));

const overlap = relatedTestSelection(sha("a"), sha("b"), [callsProof], { changedSourcePaths: ["src/app/call-logs/page.tsx"], runner: () => ({ status: 0, stdout: `${resolve(root, callsProof.paths[0])}\n` }) });
assert.deepEqual(overlap.discoveredTestPaths, [callsProof.paths[0]]); assert.deepEqual(overlap.uncoveredTestPaths, []); assert.equal(overlap.executable, null);

const pgProof = proofs.find((proof) => proof.id === "control-postgres-smoke"), pgCommands = compileRegisteredCommandPlan({ proof: pgProof, baseSha: sha("a"), headSha: sha("b") }), dockerCalls = [];
const dockerRunner = (file, args, options = {}) => { dockerCalls.push({ file, args, env: options.env }); if (file === "bash" || file === "pg_isready") return { status: 1, stdout: "", stderr: "" }; if (args?.[0] === "info") return { status: 0, stdout: "17.6", stderr: "" }; return { status: 0, stdout: "ok", stderr: "" }; };
assert.deepEqual(detectPostgresBackend({ runner: dockerRunner }).backend, "docker");
const pgAttempt = executeAttempt(pgCommands, "postgres", { runner: dockerRunner }); assert(pgAttempt.commands.every((command) => command.exitCode === 0));
assert(dockerCalls.some((call) => call.args?.[0] === "rm")); assert(dockerCalls.some((call) => call.args?.[0] === "network" && call.args?.[1] === "rm"));
const forbiddenDatabaseEnvironmentKeys = ["SUPABASE_URL", ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"), "DATABASE_URL"];
assert(dockerCalls.every((call) => forbiddenDatabaseEnvironmentKeys.every((key) => !call.env?.[key])));
assert(dockerCalls.every((call) => !call.env?.NEXT_PUBLIC_SUPABASE_URL || call.env.NEXT_PUBLIC_SUPABASE_URL === "https://e2e.supabase.co"));
assert(!JSON.stringify(dockerCalls).match(/customer_prod|production\.example/));
assert.equal(detectPostgresBackend({ runner: () => ({ status: 1, stdout: "", stderr: "" }) }).status, "REMOTE_ONLY_POSTGRES");
const failingCalls = [], failingRunner = (file, args) => { failingCalls.push([file, args]); if (file === "bash" || file === "pg_isready") return { status: 1, stdout: "", stderr: "" }; if (args?.[0] === "info" || args?.[0] === "network" || args?.[0] === "exec" || args?.[0] === "rm") return { status: 0, stdout: "ok", stderr: "" }; return { status: args?.includes("insert into proof_smoke values (1, 'ready')") ? 1 : 0, stdout: "", stderr: "fixture invalid" }; };
const failedAttempt = executeAttempt(pgCommands, "postgres", { runner: failingRunner }); assert(failedAttempt.commands.some((command) => command.phase === "fixture" && command.exitCode === 1)); assert(!failedAttempt.commands.some((command) => command.phase === "assertion")); assert(failingCalls.some(([, args]) => args?.[0] === "rm"));

const baseLedger = { schemaVersion: 1, source: "owner", lastAppliedOwnerMigration: 54, immutableThrough: 54 }, headLedger = { ...baseLedger, lastAppliedOwnerMigration: 55, immutableThrough: 55 }, migrationBytes = "select 1;\n", migrationSha256 = sha256(migrationBytes);
assert.equal(validateOwnerLedgerFastPath({ baseLedger, headLedger, migrationPath: "supabase/migrations/055_fixture.sql", baseMigrationBytes: migrationBytes, headMigrationBytes: migrationBytes, certification: { migration: 55, migrationSha256, ownerApproved: true } }).effect, "OWNER_LEDGER_TRANSITION");
assert.throws(() => validateOwnerLedgerFastPath({ baseLedger, headLedger, migrationPath: "supabase/migrations/055_fixture.sql", baseMigrationBytes: migrationBytes, headMigrationBytes: `${migrationBytes}--changed`, certification: { migration: 55, migrationSha256, ownerApproved: true } }), /IDENTITY/);

const verified = { fingerprint: hex("f"), status: "VERIFIED", occurrences: 2, domains: ["calls"], pathHints: [], proofKinds: ["postgres"], proofIds: ["receivables-postgres"], environment: {}, evidenceRefs: ["run:1"], failureSignature: "constraint calls_owner failed", rootCause: "fixture", correctionPrinciple: "scope proof", regressionRefs: ["test:1"], regressionPassed: true, lastSeen: now };
const recurrence = { ...verified, status: "OBSERVED", occurrences: 1, rootCause: null, correctionPrinciple: null, regressionRefs: [], regressionPassed: false, evidenceRefs: ["run:2"] };
const canonical = upsertIncident(recurrence, { registry: { schemaVersion: 1, incidents: [verified] }, persist: false }).incidents[0]; assert.equal(canonical.status, "VERIFIED"); assert.equal(canonical.rootCause, "fixture"); assert.equal(canonical.occurrences, 3);
const relevance = selectExperience({ domains: [], requiredProofIds: [], requiredProofKinds: ["postgres"] }, { lessons: [], incidents: [verified], budget: 900 }); assert.equal(relevance.length, 1);

const assumptions = deriveAssumptions({ risk: "R3", effects: ["AUTHORIZATION", "DATABASE"], domains: ["calls"], changedPaths: ["src/app/api/call-logs/confirm/route.ts"], requiredProofs: [callsProof, proofs.find((proof) => proof.id === "auth-unit"), proofs.find((proof) => proof.id === "receivables-postgres")] });
const rpc = assumptions.find((item) => item.class === "rpc_api_signatures"), database = assumptions.find((item) => item.class === "database_constraints"); assert(!rpc.allowedEvidenceProofIds.includes("receivables-postgres")); assert.equal(database.allowedEvidenceProofIds.length, 0);
const unrelatedReceipt = { proofId: "receivables-postgres", kind: "postgres", status: "PASS", evidencePayloadHash: hex("a") }, parity = { status: "PASS", parityHash: hex("b") }, identity = { headSha: sha("a") }, ledger = validateMigrationLedger(baseLedger);
assert.equal(proveAssumptions([rpc], { parity, receipts: [unrelatedReceipt], ledger, identity })[0].status, "UNPROVEN");

const session = serializeSessionContext({ kernel: "V6A", boundTaskId: "task-1", task: { objective: "keep durable context complete", acceptance: [{ id: "A", status: "PENDING" }], writeScope: ["scripts/engineering/task-state.mjs"], nextAction: "run focused proof" } });
assert(Buffer.byteLength(session) < 9_000); assert.match(session, /task-1/); assert.match(session, /IMPLEMENTATION_READY|durable context complete/);
const contextPointer = { schemaVersion: 1, taskId: "task-1", revision: 7, path: ".tmp/engineering/fixture/snapshot.json", byteCount: 10_000, sha256: hex("c") }, compactSession = JSON.parse(serializeSessionContext({ kernel: "V6A", required: "x".repeat(9_000) }, 900, contextPointer));
assert.equal(compactSession.sessionStatus, "CONTEXT_REREAD_REQUIRED"); assert.deepEqual(compactSession.contextPointer, contextPointer); assert.throws(() => serializeSessionContext({ required: "x".repeat(9_000) }), /SESSION_CONTEXT_POINTER_REQUIRED/); assert.throws(() => serializeSessionContext({ token: "unsafe" }), /SESSION_CONTEXT_SENSITIVE_DATA/);

const state = resolve(tmpdir(), `zd-precision-${randomUUID()}`), priorState = process.env.ZD_OS_STATE_ROOT; process.env.ZD_OS_STATE_ROOT = state; mkdirSync(resolve(state, "metric-task"), { recursive: true }); writeTaskExperience("metric-task", { schemaVersion: 1, task: "metric-task", assumptions: [], incidents: [], metrics: { events: {}, pushCount: 0, ciAttemptCount: 0, firstPassCiSuccess: null } });
recordMetricEvent("metric-task", { type: "push", key: sha("a") }); recordMetricEvent("metric-task", { type: "push", key: sha("a") }); recordMetricEvent("metric-task", { type: "ci", key: `7:${sha("a")}` });
let metrics = readTaskExperience("metric-task").metrics; assert.equal(metrics.pushCount, 1); assert.equal(metrics.ciAttemptCount, 1); assert.equal(metrics.firstPassCiSuccess, null);
recordMetricEvent("metric-task", { type: "ci", key: `7:${sha("a")}`, concluded: true, success: true }); metrics = readTaskExperience("metric-task").metrics; assert.equal(metrics.ciAttemptCount, 1); assert.equal(metrics.firstPassCiSuccess, true);
recordMetricEvent("metric-task", { type: "remote-local-failure", key: `7:${sha("a")}` }); recordMetricEvent("metric-task", { type: "remote-local-failure", key: `7:${sha("a")}` }); metrics = readTaskExperience("metric-task").metrics; assert.equal(metrics.locallyReproducibleFailuresFirstDiscoveredRemotely, 1);
if (priorState === undefined) delete process.env.ZD_OS_STATE_ROOT; else process.env.ZD_OS_STATE_ROOT = priorState; rmSync(state, { recursive: true, force: true });

const workflow = readFileSync(resolve(root, ".github/workflows/product-verification.yml"), "utf8"); assert.equal(validateProofCiParity({ proofs, workflow }).status, "PASS");
assert(!workflow.includes("--proof control-postgres-matrix")); assert.equal((readJson("package.json").scripts["vercel-build"].match(/jest|npm run test/g) ?? []).length, 0); assert(!readFileSync(resolve(root, "playwright.config.ts"), "utf8").includes("on-first-retry"));

const graphRoot = resolve(tmpdir(), `zd-graph-${randomUUID()}`), graphPath = resolve(graphRoot, "graph.json"), stampPath = resolve(graphRoot, ".crm-tree"), cachePath = resolve(graphRoot, "query.json"), tree = sha("9"); mkdirSync(graphRoot, { recursive: true }); writeFileSync(graphPath, "{}\n"); writeFileSync(stampPath, `${tree}\n`);
const sourceIndex = buildSourceIndex({ writeCache: false }), located = sourceIndex.files.find((file) => file.path === "scripts/engineering/proof-plan.mjs"); let graphQueries = 0;
const resolved = resolveContext({ task: `precision supplied index ${randomUUID()}`, index: sourceIndex, graphifyOptions: { graphPath, stampPath, cachePath, headSha: sha("8"), treeSha: tree, executable: "graphify-fixture", spawn: (_file, args) => args[0] === "--version" ? { status: 0, stdout: "graphify 0.9.48" } : (graphQueries += 1, { status: 0, stdout: `${located.path}\n` }) } });
assert.equal(resolved.graphifyEvidence.status, "GRAPHIFY_QUERIED"); assert.equal(resolved.graphifyEvidence.grantsAuthority, false); assert.equal(graphQueries, 1); rmSync(graphRoot, { recursive: true, force: true });

console.log(JSON.stringify({ code: "V6A_PRECISION_TEST_PASS", selectedUi: uiPlan.requiredProofs, selectedDb: dbPlan.requiredProofs, graphQueries }));
