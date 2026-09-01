import assert from "node:assert/strict";
import { sha256 } from "./kernel-lib.mjs";
import { deriveAssumptions, externalCliInvocation, isGitStateChangingCommand, isGitStateRevalidationCommand, normalizeFailureSignature, repeatedFailureBlockers, runDatabaseProofPhases, runExternalCli, selectExperience, upsertIncident, validateIncident } from "./experience.mjs";
import { requireWritableImpact, semanticRemoteFailure, validatePrepushCertificate } from "./readiness.mjs";
import { validateProofCiParity } from "./proof-command-plan.mjs";
import { proofExecutionEnvironment } from "./proof-runner.mjs";
import { mutableCurrentStateLiteralViolations } from "../quality/dynamic-state-guard.mjs";

const normalizedA = normalizeFailureSignature(`${String.fromCharCode(67)}:\\tmp\\kernel_test_abc 2026-08-31T12:00:00Z deadbeef assertion.ts:42:7 failed`);
const normalizedB = normalizeFailureSignature(`${String.fromCharCode(68)}:\\other\\kernel_test_xyz 2026-09-01T02:00:00Z cafebabe assertion.ts:99:2 failed`);
assert.equal(normalizedA, normalizedB);
assert.equal(proofExecutionEnvironment("e2e", {}, {}).PLAYWRIGHT_REUSE_EXISTING_SERVER, "false");

const lessons = [
  { id: "FIXTURE", domains: ["engineering-control"], risk: ["R3"], triggers: ["fixture"], rule: "Validate fixture before assertion.", enforcementRefs: ["fixture-proof"] },
  { id: "MONEY", domains: ["receivables"], risk: ["R3"], triggers: ["money"], rule: "Money rule." },
];
const verifiedIncident = validateIncident({ fingerprint: "a".repeat(64), status: "VERIFIED", occurrences: 2, domains: ["engineering-control"], pathHints: ["scripts/engineering/experience.mjs"], proofKinds: ["unit"], environment: { platform: process.platform }, evidenceRefs: ["run:1"], failureSignature: "fixture failed", rootCause: "invalid fixture", incompleteCorrection: "the first correction missed an equivalent fixture", correctionPrinciple: "Validate real schema first.", sweepEvidence: ["all equivalent fixtures searched"], regressionRefs: ["experience.test"], regressionPassed: true });
const packet = selectExperience({ task: "fix fixture readiness", domains: ["engineering-control"], risk: "R3", candidatePaths: ["scripts/engineering/experience.mjs"], requiredProofRefs: ["unit"], environment: { platform: process.platform } }, { lessons, incidents: [verifiedIncident], budget: 900 });
assert(packet.some((item) => item.id === "FIXTURE"));
assert(packet.some((item) => item.id.startsWith("INCIDENT:")));
assert(!packet.some((item) => item.id === "MONEY"));
assert(Buffer.byteLength(JSON.stringify(packet)) <= 900);

assert.throws(() => validateIncident({ fingerprint: "bad", status: "VERIFIED", occurrences: 1 }), /INCOMPLETE/);
assert.equal(upsertIncident(verifiedIncident, { registry: { schemaVersion: 1, incidents: [] }, persist: false }).incidents.length, 1);
assert.equal(repeatedFailureBlockers([{ ...verifiedIncident, status: "OBSERVED", rootCause: null }]).length, 1);
assert.equal(repeatedFailureBlockers([verifiedIncident]).length, 0);

const assumptions = deriveAssumptions({ task: "R3 database fixture external CLI release", risk: "R3", identity: { headSha: "a" } });
for (const expected of ["current_git_identity", "filesystem_root", "proof_ci_coverage", "production_authority", "database_constraints", "current_migration_boundary", "external_cli_contract"]) assert(assumptions.some((item) => item.class === expected));

const parityProofs = [{ id: "unit", kind: "unit" }, { id: "handover", kind: "handover" }, { id: "owner", kind: "owner-pre" }];
assert.equal(validateProofCiParity({ proofs: parityProofs, workflow: "jobs:\n  preflight:\n    steps:\n      - run: proof:run -- --kind unit\n      - run: proof:run -- --kind handover\n" }).status, "PASS");
assert(validateProofCiParity({ proofs: parityProofs, workflow: "jobs:\n  preflight:\n    steps:\n      - run: proof:run -- --kind unit\n" }).failures.includes("PROOF_CI_KIND_MISSING:handover"));

const B = 71;
const liveLiteral = `const current = inspectMigrationBoundaryTransition(); assert.equal(current.immutableThrough, ${B});`;
const dynamicCurrent = "const current = inspectMigrationBoundaryTransition(); assert.equal(current.nextLegalMigration, current.immutableThrough + 1);";
const synthetic = `const current = { immutableThrough: ${B} }; assert.equal(current.immutableThrough, ${B}); const next = ${B + 1};`;
assert.equal(mutableCurrentStateLiteralViolations(liveLiteral).length, 1);
assert.equal(mutableCurrentStateLiteralViolations(dynamicCurrent).length, 0);
assert.equal(mutableCurrentStateLiteralViolations(synthetic).length, 0);

let assertionRan = false;
assert.throws(() => runDatabaseProofPhases({ schema: "schema", fixture: "invalid", assertion: "assertion", execute: (_command, phase) => ({ status: phase === "fixture" ? 1 : (assertionRan ||= phase === "assertion", 0) }) }), /FIXTURE_INVALID_BEFORE_ASSERTION/);
assert.equal(assertionRan, false);
assert.deepEqual(runDatabaseProofPhases({ schema: "schema", fixture: "valid", assertion: "assertion", execute: () => ({ status: 0 }) }).map((item) => item.phase), ["schema", "fixture", "assertion"]);

assert.deepEqual(externalCliInvocation({ command: "fixture", nodeBin: "fixture-bin.js", platform: "win32", nodeExecutable: "node.exe" }), { executable: "node.exe", prefixArgs: ["fixture-bin.js"] });
const stderrResult = runExternalCli({ command: "fixture", args: ["inspect"], spawn: () => ({ status: 0, stdout: "", stderr: "{\"id\":\"fixture\"}" }) });
assert.match(stderrResult.combined, /fixture/);
assert.equal(runExternalCli({ command: process.execPath, args: ["--version"] }).exitCode, 0);
assert.throws(() => runExternalCli({ command: "fixture", spawn: () => ({ status: 2, stdout: "", stderr: "failed" }) }), /EXTERNAL_CLI_FAILED/);

assert.equal(isGitStateChangingCommand("git switch feat/x"), true);
assert.equal(isGitStateRevalidationCommand("git branch --show-current\ngit rev-parse HEAD\ngit status --porcelain=v1"), true);
assert.equal(isGitStateRevalidationCommand("git status --porcelain=v1"), false);

const identity = { baseSha: "a".repeat(40), headSha: "b".repeat(40), treeSha: "c".repeat(40), dirtyFingerprint: sha256("") }, impact = { impactHash: "d".repeat(64) }, plan = { planHash: "e".repeat(64) };
const certificate = { schemaVersion: 1, status: "READY", task: "task-fixture", ...identity, impactHash: impact.impactHash, planHash: plan.planHash, unresolvedFailureFingerprints: [] };
certificate.certificateHash = sha256(JSON.stringify(certificate));
assert.equal(validatePrepushCertificate({ certificate, taskId: "task-fixture", identity, impact, plan }).status, "READY");
assert.throws(() => validatePrepushCertificate({ certificate, taskId: "task-fixture", identity: { ...identity, headSha: "f".repeat(40) }, impact, plan }), /STALE/);
assert.throws(() => requireWritableImpact({ writable: false, unresolved: [{ code: "UNMAPPED_PATH", path: "fixture.config.ts" }] }), /IMPACT_UNRESOLVED:UNMAPPED_PATH:fixture\.config\.ts/);
assert.equal(semanticRemoteFailure('preflight\tstep\t  "code": "UNMAPPED_PATH",\npreflight\tstep\t  "path": "playwright.config.ts"'), "UNMAPPED_PATH:playwright.config.ts");

console.log(JSON.stringify({ code: "EXPERIENCE_LEARNING_MATRIX_PASS", packetBytes: Buffer.byteLength(JSON.stringify(packet)), lessonCount: packet.length, host: process.platform }));
