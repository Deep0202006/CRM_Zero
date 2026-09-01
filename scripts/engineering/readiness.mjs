import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { compileImpact } from "./impact.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { canonicalEvidencePath, proofFailureDiagnostics, runRegisteredProof } from "./proof-runner.mjs";
import { expectedCiJob, validateProofCiParity } from "./proof-command-plan.mjs";
import { dirtyFingerprint, git, parseArgs, readJson, repositoryIdentity, root, run, sha256, validateMigrationLedger } from "./kernel-lib.mjs";
import { findActiveTask } from "./task-state.mjs";
import { invalidatePrepushCertificate, normalizeFailureSignature, readIncidentRegistry, readPrepushCertificate, readTaskExperience, recordFailure, repeatedFailureBlockers, writePrepushCertificate, writeTaskExperience } from "./experience.mjs";

const emptyFingerprint = sha256("");
const certificateBody = (certificate) => Object.fromEntries(Object.entries(certificate).filter(([key]) => key !== "certificateHash"));
export const validatePrepushCertificate = ({ certificate, taskId, identity, impact, plan }) => {
  if (!certificate || certificate.status !== "READY" || certificate.task !== taskId) throw new Error("PREPUSH_CERTIFICATE_REQUIRED");
  if (certificate.certificateHash !== sha256(JSON.stringify(certificateBody(certificate)))) throw new Error("PREPUSH_CERTIFICATE_INVALID");
  for (const key of ["baseSha", "headSha", "treeSha", "dirtyFingerprint"]) if (certificate[key] !== identity[key]) throw new Error("PREPUSH_CERTIFICATE_STALE");
  if (certificate.impactHash !== impact.impactHash || certificate.planHash !== plan.planHash) throw new Error("PREPUSH_CERTIFICATE_STALE");
  if (certificate.unresolvedFailureFingerprints?.length) throw new Error("REPEATED_FAILURE_NOT_LEARNED");
  return certificate;
};

const workflowRelatedPaths = (base, head) => git("diff", "--name-only", "-z", base, head, "--", "src").split("\0").filter((path) => /\.(?:ts|tsx|js|jsx)$/.test(path));
export const relatedTestSelection = (base, head) => {
  const paths = workflowRelatedPaths(base, head);
  const args = paths.length ? ["test", "--", "--runInBand", "--findRelatedTests", ...paths] : [];
  return { paths, executable: paths.length ? "npm" : null, args, identity: sha256(JSON.stringify({ executable: paths.length ? "npm" : null, args })) };
};

const commandAvailable = (file, args = ["--version"]) => {
  const result = run(file, args);
  return result.status === 0;
};
const capabilityFor = (proof) => {
  if (["owner-pre", "owner-post"].includes(proof.kind)) return { local: false, reason: "HUMAN_OWNER_PROOF" };
  if (proof.kind === "postgres") return commandAvailable("bash") && commandAvailable("pg_isready", ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres"]) ? { local: true, reason: "LOOPBACK_POSTGRES_READY" } : { local: false, reason: "DISPOSABLE_POSTGRES_UNAVAILABLE" };
  return { local: true, reason: "INSTALLED_REPOSITORY_TOOLCHAIN" };
};

const matchingEvidence = (proof, plan) => {
  const path = canonicalEvidencePath(proof.id, expectedCiJob(proof));
  if (!existsSync(path)) return null;
  try {
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    if (evidence.status === "PASS" && evidence.baseSha === plan.baseSha && evidence.headSha === plan.headSha && evidence.treeSha === plan.treeSha && evidence.impactHash === plan.impactHash && evidence.planHash === plan.planHash) return evidence;
  } catch { /* stale evidence is replaced */ }
  rmSync(path, { force: true });
  return null;
};

const proveAssumptions = (assumptions, { parity, receipts, ledger, identity }) => assumptions.map((assumption) => {
  if (assumption.class === "current_git_identity") return { ...assumption, evidence: identity, status: "PROVEN" };
  if (assumption.class === "filesystem_root") return { ...assumption, evidence: root, status: "PROVEN" };
  if (assumption.status === "PROVEN") return assumption;
  if (assumption.class === "proof_ci_coverage" && parity.status === "PASS") return { ...assumption, evidence: parity.parityHash, status: "PROVEN" };
  if (assumption.class === "database_constraints") {
    const local = receipts.filter((receipt) => receipt.kind === "postgres" && receipt.status === "PASS"), verified = readIncidentRegistry().incidents.filter((incident) => incident.status === "VERIFIED" && /fixture|constraint/i.test(`${incident.failureSignature} ${incident.correctionPrinciple}`));
    if (local.length || verified.length) return { ...assumption, evidence: local.length ? local.map((receipt) => receipt.evidencePayloadHash) : verified.flatMap((incident) => incident.evidenceRefs).slice(0, 8), status: "PROVEN" };
  }
  if (assumption.class === "current_migration_boundary") return { ...assumption, evidence: `${ledger.immutableThrough}/${ledger.lastAppliedOwnerMigration}`, status: "PROVEN" };
  if (assumption.class === "rpc_api_signatures" && receipts.some((receipt) => receipt.kind === "unit" && receipt.status === "PASS")) return { ...assumption, evidence: receipts.find((receipt) => receipt.kind === "unit").evidencePayloadHash, status: "PROVEN" };
  if (assumption.class === "external_cli_contract" && receipts.some((receipt) => receipt.proofId === "kernel-preflight" && receipt.status === "PASS")) return { ...assumption, evidence: receipts.find((receipt) => receipt.proofId === "kernel-preflight").evidencePayloadHash, status: "PROVEN" };
  return assumption;
});

export const certifyPrepush = ({ execute = true } = {}) => {
  const task = findActiveTask();
  if (!task) throw new Error("ACTIVE_TASK_REQUIRED");
  const identity = repositoryIdentity(root, "origin/main");
  if (identity.dirtyFingerprint !== emptyFingerprint) throw new Error("CLEAN_COMMITTED_HEAD_REQUIRED");
  const impact = compileImpact({ base: "origin/main", head: "HEAD" }), plan = compileProofPlan({ impact });
  const proofs = readJson("docs/engineering/PROOFS.json").proofs, workflow = readFileSync(resolve(root, ".github/workflows/product-verification.yml"), "utf8"), parity = validateProofCiParity({ proofs, workflow });
  if (parity.status !== "PASS") throw new Error(`PROOF_CI_PARITY_FAILED:${parity.failures.join(",")}`);
  const related = relatedTestSelection(plan.baseSha, plan.headSha);
  if (execute && related.executable) { const result = run(related.executable, related.args); if (result.status !== 0) throw new Error(`RELATED_TESTS_FAILED:${normalizeFailureSignature(result.stderr || result.stdout)}`); }
  const receipts = [], capabilities = []; let reused = 0;
  for (const proofId of plan.requiredProofs) {
    const proof = proofs.find((item) => item.id === proofId), capability = capabilityFor(proof);
    capabilities.push({ proofId, kind: proof.kind, ...capability });
    if (!capability.local) continue;
    let evidence = matchingEvidence(proof, plan); if (evidence) reused += 1;
    if (!evidence && execute) evidence = runRegisteredProof({ proofId, base: "origin/main", head: "HEAD", plan });
    if (!evidence || evidence.status !== "PASS") {
      const diagnostic = normalizeFailureSignature(proofFailureDiagnostics(evidence ?? { attempts: [] })[0] ?? `${evidence?.status ?? "MISSING"}:${proofId}`);
      recordFailure({ taskId: task.taskId, signature: diagnostic, evidenceRefs: [`local-proof:${proofId}`], proofKinds: [proof.kind], environment: { platform: process.platform } });
      throw new Error(`LOCAL_PROOF_REQUIRED:${proofId}:${diagnostic}`);
    }
    receipts.push(evidence);
  }
  const taskExperience = readTaskExperience(task.taskId), ledger = validateMigrationLedger(readJson("supabase/migrations/APPLIED_OWNER_MIGRATIONS.json")), assumptions = proveAssumptions(taskExperience.assumptions ?? [], { parity, receipts, ledger, identity });
  const unproven = assumptions.filter((item) => item.status !== "PROVEN"), repeated = repeatedFailureBlockers(taskExperience.incidents);
  if (unproven.length) throw new Error(`ASSUMPTION_UNPROVEN:${unproven.map((item) => item.class).join(",")}`);
  if (repeated.length) throw new Error(`REPEATED_FAILURE_NOT_LEARNED:${repeated.map((item) => item.fingerprint).join(",")}`);
  const metrics = { ...taskExperience.metrics, proofExecutions: (taskExperience.metrics?.proofExecutions ?? 0) + receipts.length - reused, proofReuse: (taskExperience.metrics?.proofReuse ?? 0) + reused, repeatedFailureSignatures: repeated.length };
  writeTaskExperience(task.taskId, { ...taskExperience, assumptions, metrics });
  const certificate = {
    schemaVersion: 1,
    status: "READY",
    task: task.taskId,
    ...identity,
    impactHash: impact.impactHash,
    planHash: plan.planHash,
    relatedTestCommandIdentity: related.identity,
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
  const identity = repositoryIdentity(root, "origin/main"), impact = compileImpact({ base: "origin/main", head: "HEAD" }), plan = compileProofPlan({ impact });
  return validatePrepushCertificate({ certificate: readPrepushCertificate(task.taskId), taskId: task.taskId, identity, impact, plan });
};

const parseJson = (result, code) => { if (result.status !== 0) throw new Error(code); try { return JSON.parse(result.stdout); } catch { throw new Error(code); } };
export const intakeCurrentRemoteFailure = ({ runner = run } = {}) => {
  const task = findActiveTask(); if (!task) return null;
  const branch = git("branch", "--show-current"), head = git("rev-parse", "HEAD");
  const prs = parseJson(runner("gh", ["pr", "list", "--repo", "Deep0202006/CRM_Zero", "--head", branch, "--state", "open", "--json", "number,headRefOid"]), "REMOTE_FAILURE_PR_UNAVAILABLE");
  const pr = prs.find((item) => item.headRefOid === head); if (!pr) return null;
  const runs = parseJson(runner("gh", ["run", "list", "--repo", "Deep0202006/CRM_Zero", "--branch", branch, "--limit", "20", "--json", "databaseId,headSha,status,conclusion,workflowName,url"]), "REMOTE_FAILURE_RUN_UNAVAILABLE");
  const workflowRun = runs.find((item) => item.headSha === head && item.conclusion === "failure"); if (!workflowRun) return null;
  const view = parseJson(runner("gh", ["run", "view", String(workflowRun.databaseId), "--repo", "Deep0202006/CRM_Zero", "--json", "jobs"]), "REMOTE_FAILURE_JOB_UNAVAILABLE"), job = view.jobs.find((item) => item.conclusion === "failure"), step = job?.steps?.find((item) => item.conclusion === "failure");
  const log = job ? runner("gh", ["run", "view", String(workflowRun.databaseId), "--repo", "Deep0202006/CRM_Zero", "--job", String(job.databaseId), "--log-failed"]) : { status: 1, stdout: "", stderr: "" };
  const logLines = String(log.stdout || log.stderr).split(/\r?\n/).map((line) => line.trim()).filter(Boolean), firstFailure = logLines.find((line) => /(?:EVIDENCE_[A-Z_]+|AssertionError|ERROR:\s.*constraint|FAIL\s+[^\s]|ENOENT)/.test(line)) ?? logLines.find((line) => /PROOF_COMMAND_FAILED/.test(line)) ?? logLines.find((line) => /(?:error|fail|assert|exception|constraint|not found)/i.test(line)) ?? `${job?.name ?? "unknown"}:${step?.name ?? "unknown"}`;
  const evidence = { pr: pr.number, head, workflowRun: workflowRun.databaseId, failedJob: job?.name ?? null, failedStep: step?.name ?? null, firstFailingExecutable: step?.name ?? null, firstFailure: normalizeFailureSignature(firstFailure) };
  const incident = recordFailure({ taskId: task.taskId, signature: evidence.firstFailure, evidenceRefs: [`pr:${pr.number}`, `run:${workflowRun.databaseId}`, `job:${job?.databaseId ?? "unknown"}`], environment: { platform: "github-actions", workflow: workflowRun.workflowName } });
  invalidatePrepushCertificate(task.taskId, `REMOTE_FAILURE:${incident.fingerprint}`);
  const experience = readTaskExperience(task.taskId); writeTaskExperience(task.taskId, { ...experience, metrics: { ...experience.metrics, ciAttemptCount: (experience.metrics?.ciAttemptCount ?? 0) + 1, locallyReproducibleFailuresFirstDiscoveredRemotely: (experience.metrics?.locallyReproducibleFailuresFirstDiscoveredRemotely ?? 0) + 1 } });
  return { ...evidence, fingerprint: incident.fingerprint, occurrences: incident.occurrences };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = parseArgs();
  try {
    const result = args.has("--check") ? assertPrepushReady() : args.has("--intake") ? intakeCurrentRemoteFailure() : certifyPrepush();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
