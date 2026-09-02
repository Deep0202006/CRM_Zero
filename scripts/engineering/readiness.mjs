import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compileImpact } from "./impact.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { canonicalEvidencePath, commonEvidencePath, detectPostgresBackend, proofFailureDiagnostics, runRegisteredProof, writeReuseEvidence } from "./proof-runner.mjs";
import { expectedCiJob, proofDefinitionHash, proofInputIdentity, proofRunnerIdentity, validateCommandPlan, validateProofCiParity } from "./proof-command-plan.mjs";
import { environmentPolicyHash } from "./kernel-lib.mjs";
import { readEvidenceFile } from "./proof-evidence.mjs";
import { git, parseArgs, readJson, repositoryIdentity, root, run, sha256, validateMigrationLedger } from "./kernel-lib.mjs";
import { findActiveTask } from "./task-state.mjs";
import { deriveAssumptions, invalidatePrepushCertificate, normalizeFailureSignature, readIncidentRegistry, readPrepushCertificate, readTaskExperience, recordFailure, recordMetricEvent, repeatedFailureBlockers, writePrepushCertificate, writeTaskExperience } from "./experience.mjs";

const emptyFingerprint = sha256("");
const certificateBody = (certificate) => Object.fromEntries(Object.entries(certificate).filter(([key]) => key !== "certificateHash"));
export const requireWritableImpact = (impact) => {
  if (!impact.writable) throw new Error(`IMPACT_UNRESOLVED:${impact.unresolved.map((item) => `${item.code}:${item.path ?? item.target ?? ""}`).join(",")}`);
  return impact;
};
export const validatePrepushCertificate = ({ certificate, taskId, identity, impact, plan }) => {
  if (!certificate || certificate.status !== "READY" || certificate.task !== taskId) throw new Error("PREPUSH_CERTIFICATE_REQUIRED");
  if (certificate.certificateHash !== sha256(JSON.stringify(certificateBody(certificate)))) throw new Error("PREPUSH_CERTIFICATE_INVALID");
  for (const key of ["baseSha", "headSha", "treeSha", "dirtyFingerprint"]) if (certificate[key] !== identity[key]) throw new Error("PREPUSH_CERTIFICATE_STALE");
  if (certificate.impactHash !== impact.impactHash || certificate.planHash !== plan.planHash) throw new Error("PREPUSH_CERTIFICATE_STALE");
  if (certificate.unresolvedFailureFingerprints?.length) throw new Error("REPEATED_FAILURE_NOT_LEARNED");
  return certificate;
};

const workflowRelatedPaths = (base, head) => git("diff", "--name-only", "-z", base, head, "--", "src").split("\0").filter((path) => /\.(?:ts|tsx|js|jsx)$/.test(path));
export const relatedTestSelection = (base, head, selectedProofs = [], { runner = run, changedSourcePaths } = {}) => {
  const paths = changedSourcePaths ?? workflowRelatedPaths(base, head);
  const discoveryArgs = paths.length ? ["jest", "--listTests", "--findRelatedTests", ...paths] : [];
  const discovery = paths.length ? runner("npx", discoveryArgs) : { status: 0, stdout: "" };
  if (discovery.status !== 0) throw new Error(`RELATED_TEST_DISCOVERY_FAILED:${normalizeFailureSignature(discovery.stderr || discovery.stdout)}`);
  const normalize = (path) => String(path).replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, "");
  const discoveredTestPaths = String(discovery.stdout).split(/\r?\n/).map(normalize).filter(Boolean).sort();
  const selectedUnitProofTestPaths = [...new Set(selectedProofs.filter((proof) => proof.kind === "unit").flatMap((proof) => proof.runner === "jest" ? proof.paths : []).map(normalize))].sort();
  const covered = new Set(selectedUnitProofTestPaths), uncoveredTestPaths = discoveredTestPaths.filter((path) => !covered.has(path));
  const args = uncoveredTestPaths.length ? ["jest", "--runInBand", ...uncoveredTestPaths] : [];
  return { changedSourcePaths: paths, discoveredTestPaths, selectedUnitProofTestPaths, uncoveredTestPaths, exactlyExecutedTestPaths: uncoveredTestPaths, executable: args.length ? "npx" : null, args, identity: sha256(JSON.stringify({ paths, discoveredTestPaths, selectedUnitProofTestPaths, uncoveredTestPaths })) };
};
export const executeRelatedTests = ({ base = "origin/main", head = "HEAD", runner = run } = {}) => {
  const plan = compileProofPlan({ base, head }), proofs = readJson("docs/engineering/PROOFS.json").proofs;
  const selection = relatedTestSelection(plan.baseSha, plan.headSha, plan.requiredProofs.map((id) => proofs.find((proof) => proof.id === id)), { runner });
  if (selection.executable) { const result = runner(selection.executable, selection.args); if (result.status !== 0) throw new Error(`RELATED_TESTS_FAILED:${normalizeFailureSignature(result.stderr || result.stdout)}`); }
  return selection;
};

const capabilityFor = (proof) => {
  if (["owner-pre", "owner-post"].includes(proof.kind)) return { local: false, reason: "HUMAN_OWNER_PROOF" };
  if (proof.kind === "build") return { local: false, reason: "CI_ONLY_BUILD" };
  if (proof.kind === "postgres") { const capability = detectPostgresBackend(); return { local: capability.status === "AVAILABLE", reason: capability.status === "AVAILABLE" ? `DISPOSABLE_POSTGRES_${capability.backend.toUpperCase()}` : "REMOTE_ONLY_POSTGRES", backend: capability.backend }; }
  return { local: true, reason: "INSTALLED_REPOSITORY_TOOLCHAIN" };
};

export const evaluateReuseCandidate = ({ proof, source, plan, incrementalImpact, incidents = readIncidentRegistry().incidents, isAncestor = (left, right) => run("git", ["merge-base", "--is-ancestor", left, right]).status === 0 }) => {
  if (!source || source.status !== "PASS" || source.baseSha !== plan.baseSha || !isAncestor(source.headSha, plan.headSha)) return { reusable: false, reason: "SOURCE_EVIDENCE_INELIGIBLE" };
  const input = proofInputIdentity(proof);
  if (source.proofDefinitionHash !== proofDefinitionHash(proof) || source.runnerIdentity !== proofRunnerIdentity() || source.environmentPolicyHash !== environmentPolicyHash() || source.proofInputHash !== input.proofInputHash) return { reusable: false, reason: "PROOF_INPUT_CHANGED" };
  if (!incrementalImpact.writable || incrementalImpact.changes.some((change) => change.unknown)) return { reusable: false, reason: "INCREMENTAL_IMPACT_UNKNOWN" };
  if (incidents.some((incident) => incident.status === "VERIFIED" && Date.parse(incident.lastSeen ?? 0) > Date.parse(source.endedAt) && ((incident.proofKinds ?? []).includes(proof.kind) || (incident.proofIds ?? []).includes(proof.id)))) return { reusable: false, reason: "VERIFIED_INCIDENT_INVALIDATION" };
  const decision = { sourceEvidenceHash: source.evidencePayloadHash, sourceHeadSha: source.headSha, currentHeadSha: plan.headSha, proofInputHash: input.proofInputHash, incrementalImpactHash: incrementalImpact.impactHash };
  return { reusable: true, ...decision, reuseDecisionHash: sha256(JSON.stringify(decision)) };
};

const matchingEvidence = (proof, plan) => {
  const canonical = canonicalEvidencePath(proof.id, expectedCiJob(proof));
  if (existsSync(canonical)) { try { const current = readEvidenceFile(canonical); if (["PASS", "REUSED"].includes(current.status) && current.headSha === plan.headSha && current.treeSha === plan.treeSha && current.impactHash === plan.impactHash && current.planHash === plan.planHash && current.proofDefinitionHash === proofDefinitionHash(proof) && current.runnerIdentity === proofRunnerIdentity() && current.environmentPolicyHash === environmentPolicyHash() && current.proofInputHash === proofInputIdentity(proof).proofInputHash) return current; } catch { /* stale */ } }
  const directory = commonEvidencePath(proof.id, "unused").replace(/[\\/]unused\.json$/, "");
  if (!existsSync(directory)) return null;
  for (const name of readdirSync(directory).filter((item) => item.endsWith(".json")).reverse()) {
    try {
      const source = readEvidenceFile(resolve(directory, name));
      const incrementalImpact = compileImpact({ base: source.headSha, head: plan.headSha });
      const decision = evaluateReuseCandidate({ proof, source, plan, incrementalImpact });
      if (decision.reusable) return writeReuseEvidence({ proof, source, plan, incrementalImpactHash: decision.incrementalImpactHash, reuseDecisionHash: decision.reuseDecisionHash });
    } catch { /* fail closed and inspect the next immutable receipt */ }
  }
  return null;
};

export const proveAssumptions = (assumptions, { parity, receipts, ledger, identity }) => assumptions.map((assumption) => {
  if (assumption.class === "current_git_identity") return { ...assumption, evidence: identity, status: "PROVEN" };
  if (assumption.class === "filesystem_root") return { ...assumption, evidence: root, status: "PROVEN" };
  if (assumption.status === "PROVEN") return assumption;
  if (assumption.class === "proof_ci_coverage" && parity.status === "PASS") return { ...assumption, evidence: parity.parityHash, status: "PROVEN" };
  const scoped = receipts.filter((receipt) => ["PASS", "REUSED"].includes(receipt.status) && (assumption.allowedEvidenceProofIds ?? []).includes(receipt.proofId) && (assumption.allowedEvidenceKinds ?? []).includes(receipt.kind));
  if (["database_constraints", "rpc_api_signatures", "external_cli_contract"].includes(assumption.class) && scoped.length) return { ...assumption, evidence: scoped.map((receipt) => receipt.evidencePayloadHash), evidenceHash: sha256(scoped.map((receipt) => receipt.evidencePayloadHash).sort().join("\n")), status: "PROVEN" };
  if (assumption.class === "current_migration_boundary") return { ...assumption, evidence: `${ledger.immutableThrough}/${ledger.lastAppliedOwnerMigration}`, status: "PROVEN" };
  return assumption;
});

export const certifyPrepush = ({ execute = true } = {}) => {
  const task = findActiveTask();
  if (!task) throw new Error("ACTIVE_TASK_REQUIRED");
  const identity = repositoryIdentity(root, "origin/main");
  if (identity.dirtyFingerprint !== emptyFingerprint) throw new Error("CLEAN_COMMITTED_HEAD_REQUIRED");
  const impact = requireWritableImpact(compileImpact({ base: "origin/main", head: "HEAD" })), plan = compileProofPlan({ impact });
  const proofs = readJson("docs/engineering/PROOFS.json").proofs, workflow = readFileSync(resolve(root, ".github/workflows/product-verification.yml"), "utf8"), parity = validateProofCiParity({ proofs, workflow });
  if (parity.status !== "PASS") throw new Error(`PROOF_CI_PARITY_FAILED:${parity.failures.join(",")}`);
  validateCommandPlan({ plan, proofs });
  const selectedProofs = plan.requiredProofs.map((proofId) => proofs.find((proof) => proof.id === proofId));
  const related = relatedTestSelection(plan.baseSha, plan.headSha, selectedProofs);
  if (execute && related.executable) { const result = run(related.executable, related.args); if (result.status !== 0) throw new Error(`RELATED_TESTS_FAILED:${normalizeFailureSignature(result.stderr || result.stdout)}`); }
  const receipts = [], capabilities = [];
  const proofOrder = (proof) => proof.id === "kernel-preflight" ? 0 : proof.kind === "unit" ? 1 : proof.kind === "handover" ? 2 : proof.kind === "postgres" ? 3 : proof.kind === "e2e" ? 4 : proof.kind === "build" ? 5 : 6;
  for (const proofId of [...plan.requiredProofs].sort((left, right) => proofOrder(proofs.find((item) => item.id === left)) - proofOrder(proofs.find((item) => item.id === right)))) {
    const proof = proofs.find((item) => item.id === proofId), capability = capabilityFor(proof);
    capabilities.push({ proofId, kind: proof.kind, ...capability });
    if (!capability.local) continue;
    let evidence = matchingEvidence(proof, plan); if (evidence?.status === "REUSED") recordMetricEvent(task.taskId, { type: "proof-reuse", key: `${proofId}:${plan.headSha}` });
    if (!evidence && execute) evidence = runRegisteredProof({ proofId, base: "origin/main", head: "HEAD", plan });
    if (!evidence || !["PASS", "REUSED"].includes(evidence.status)) {
      const diagnostic = normalizeFailureSignature(proofFailureDiagnostics(evidence ?? { attempts: [] })[0] ?? `${evidence?.status ?? "MISSING"}:${proofId}`);
      recordFailure({ taskId: task.taskId, signature: diagnostic, evidenceRefs: [`local-proof:${proofId}`], proofKinds: [proof.kind], environment: { platform: process.platform } });
      throw new Error(`LOCAL_PROOF_REQUIRED:${proofId}:${diagnostic}`);
    }
    if (evidence.status === "PASS") recordMetricEvent(task.taskId, { type: "proof-execution", key: `${proofId}:${plan.headSha}` });
    receipts.push(evidence);
  }
  for (const proofId of plan.reuseEligibleProofs ?? []) {
    if (receipts.some((receipt) => receipt.proofId === proofId)) continue;
    const proof = proofs.find((item) => item.id === proofId), evidence = matchingEvidence(proof, plan);
    if (evidence?.status === "REUSED") { receipts.push(evidence); recordMetricEvent(task.taskId, { type: "proof-reuse", key: `${proofId}:${plan.headSha}` }); }
  }
  const taskExperience = readTaskExperience(task.taskId), ledger = validateMigrationLedger(readJson("supabase/migrations/APPLIED_OWNER_MIGRATIONS.json"));
  const derived = deriveAssumptions({ risk: impact.risk, identity, effects: impact.effects, domains: impact.domains, changedPaths: impact.changedPaths, changedAuthorities: impact.changedAuthorities, operations: [...impact.writeOperations, ...impact.readOperations], requiredProofs: selectedProofs });
  const assumptions = proveAssumptions(derived, { parity, receipts, ledger, identity });
  const unproven = assumptions.filter((item) => item.status !== "PROVEN"), repeated = repeatedFailureBlockers(taskExperience.incidents);
  const locallyDeferred = new Set(capabilities.filter((item) => item.reason === "REMOTE_ONLY_POSTGRES").map((item) => item.proofId));
  const blockingUnproven = unproven.filter((item) => !(item.allowedEvidenceKinds ?? []).includes("postgres") || !(item.allowedEvidenceProofIds ?? []).every((id) => locallyDeferred.has(id)));
  if (blockingUnproven.length) throw new Error(`ASSUMPTION_UNPROVEN:${blockingUnproven.map((item) => item.class).join(",")}`);
  if (repeated.length) throw new Error(`REPEATED_FAILURE_NOT_LEARNED:${repeated.map((item) => item.fingerprint).join(",")}`);
  writeTaskExperience(task.taskId, { ...readTaskExperience(task.taskId), assumptions });
  const certificate = {
    schemaVersion: 1,
    status: "READY",
    task: task.taskId,
    ...identity,
    impactHash: impact.impactHash,
    planHash: plan.planHash,
    relatedTestCommandIdentity: related.identity,
    relatedTestSelection: related,
    proofReceipts: receipts.map((item) => ({ proofId: item.proofId, kind: item.kind, evidencePayloadHash: item.evidencePayloadHash })),
    environmentCapabilities: capabilities,
    assumptions,
    unresolvedFailureFingerprints: [],
    certifiedAt: new Date().toISOString(),
  };
  certificate.certificateHash = sha256(JSON.stringify(certificateBody(certificate)));
  writePrepushCertificate(task.taskId, certificate);
  return certificate;
};

export const assertPrepushReady = () => {
  const task = findActiveTask(); if (!task) throw new Error("ACTIVE_TASK_REQUIRED");
  const identity = repositoryIdentity(root, "origin/main"), impact = requireWritableImpact(compileImpact({ base: "origin/main", head: "HEAD" })), plan = compileProofPlan({ impact });
  return validatePrepushCertificate({ certificate: readPrepushCertificate(task.taskId), taskId: task.taskId, identity, impact, plan });
};

const parseJson = (result, code) => { if (result.status !== 0) throw new Error(code); try { return JSON.parse(result.stdout); } catch { throw new Error(code); } };
export const semanticRemoteFailure = (text, job = "unknown", step = "unknown") => {
  const unresolved = /"code":\s*"([A-Z0-9_]+)"[\s\S]{0,600}?"path":\s*"([^"]+)"/.exec(text);
  if (unresolved) return normalizeFailureSignature(`${unresolved[1]}:${unresolved[2]}`);
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return normalizeFailureSignature(lines.find((line) => /(?:EVIDENCE_[A-Z_]+|AssertionError|ERROR:\s.*constraint|FAIL\s+[^\s]|ENOENT)/.test(line)) ?? lines.find((line) => /PROOF_COMMAND_FAILED/.test(line)) ?? lines.find((line) => /(?:error|fail|assert|exception|constraint|not found)/i.test(line)) ?? `${job}:${step}`);
};
export const intakeCurrentRemoteFailure = ({ runner = run } = {}) => {
  const task = findActiveTask(); if (!task) return null;
  const branch = git("branch", "--show-current"), head = git("rev-parse", "HEAD");
  const prs = parseJson(runner("gh", ["pr", "list", "--repo", "Deep0202006/CRM_Zero", "--head", branch, "--state", "open", "--json", "number,headRefOid"]), "REMOTE_FAILURE_PR_UNAVAILABLE");
  const pr = prs.find((item) => item.headRefOid === head); if (!pr) return null;
  const runs = parseJson(runner("gh", ["run", "list", "--repo", "Deep0202006/CRM_Zero", "--branch", branch, "--limit", "20", "--json", "databaseId,headSha,status,conclusion,workflowName,url"]), "REMOTE_FAILURE_RUN_UNAVAILABLE");
  const workflowRun = runs.find((item) => item.headSha === head && item.conclusion === "failure"); if (!workflowRun) return null;
  const view = parseJson(runner("gh", ["run", "view", String(workflowRun.databaseId), "--repo", "Deep0202006/CRM_Zero", "--json", "jobs"]), "REMOTE_FAILURE_JOB_UNAVAILABLE"), job = view.jobs.find((item) => item.conclusion === "failure"), step = job?.steps?.find((item) => item.conclusion === "failure");
  const log = job ? runner("gh", ["run", "view", String(workflowRun.databaseId), "--repo", "Deep0202006/CRM_Zero", "--job", String(job.databaseId), "--log-failed"]) : { status: 1, stdout: "", stderr: "" };
  const evidence = { pr: pr.number, head, workflowRun: workflowRun.databaseId, failedJob: job?.name ?? null, failedStep: step?.name ?? null, firstFailingExecutable: step?.name ?? null, firstFailure: semanticRemoteFailure(log.stdout || log.stderr, job?.name, step?.name) };
  const incident = recordFailure({ taskId: task.taskId, signature: evidence.firstFailure, evidenceRefs: [`pr:${pr.number}`, `run:${workflowRun.databaseId}`, `job:${job?.databaseId ?? "unknown"}`], environment: { platform: "github-actions", workflow: workflowRun.workflowName } });
  invalidatePrepushCertificate(task.taskId, `REMOTE_FAILURE:${incident.fingerprint}`);
  recordMetricEvent(task.taskId, { type: "ci", key: `${workflowRun.databaseId}:${head}`, concluded: true, success: false });
  return { ...evidence, fingerprint: incident.fingerprint, occurrences: incident.occurrences };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = parseArgs();
  try {
    const result = args.has("--check") ? assertPrepushReady() : args.has("--intake") ? intakeCurrentRemoteFailure() : args.has("--related") ? executeRelatedTests({ base: args.value("--base", "origin/main"), head: args.value("--head", "HEAD") }) : certifyPrepush();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
