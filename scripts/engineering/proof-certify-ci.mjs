import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseVerifiedAttestation } from "./proof-attestation.mjs";
import { compileRegisteredCommandPlan, expectedCiJob, proofDefinitionHash, proofRunnerIdentity } from "./proof-command-plan.mjs";
import { evidencePayloadHash, readEvidenceFile } from "./proof-evidence.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { environmentPolicyHash, git, parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";

const evidenceDirectory = resolve(root, "artifacts/engineering-evidence");
const attestationDirectory = resolve(root, "artifacts/engineering-attestation");
const repository = "Deep0202006/CRM_Zero";
const signerWorkflow = `${repository}/.github/workflows/product-verification.yml`;
const emptySha256 = sha256("");
const validTimeRange = (startedAt, endedAt, now = Date.now()) => {
  const started = Date.parse(startedAt), ended = Date.parse(endedAt);
  return Number.isFinite(started) && Number.isFinite(ended) && started <= ended && ended <= now + 300_000;
};
const requireCiEnvironment = (environment, plan) => {
  if (environment.GITHUB_ACTIONS !== "true") throw new Error("ATTESTATION_REQUIRED");
  const required = ["GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_REF", "GITHUB_EVENT_NAME", "KERNEL_BASE_SHA", "KERNEL_HEAD_SHA"];
  if (required.some((key) => !environment[key])) throw new Error("CI_PROVENANCE_INCOMPLETE");
  if (environment.GITHUB_REPOSITORY !== repository) throw new Error("CI_REPOSITORY_MISMATCH");
  if (environment.KERNEL_BASE_SHA !== plan.baseSha || environment.KERNEL_HEAD_SHA !== plan.headSha) throw new Error("CI_GIT_IDENTITY_MISMATCH");
};
const requireOutputRecord = (proofId, index, stream, bytes, digest) => {
  if (digest === "0".repeat(64)) throw new Error(`COMMAND_OUTPUT_DIGEST_INVALID:${proofId}:${index}:${stream}`);
  if (bytes === 0 && digest !== emptySha256 || bytes > 0 && digest === emptySha256) throw new Error(`COMMAND_OUTPUT_SIZE_HASH_MISMATCH:${proofId}:${index}:${stream}`);
};

export const validateEvidenceFile = ({ path, proofId, plan, environment = process.env, now = Date.now() }) => {
  const item = readEvidenceFile(path), proof = readJson("docs/engineering/PROOFS.json").proofs.find((candidate) => candidate.id === proofId);
  if (!proof) throw new Error(`PROOF_UNMAPPED:${proofId}`);
  requireCiEnvironment(environment, plan);
  for (const [key, expected] of [["proofId", proofId], ["kind", proof.kind], ["status", "PASS"], ["headSha", plan.headSha], ["treeSha", plan.treeSha], ["baseSha", plan.baseSha], ["dirtyFingerprint", plan.dirtyFingerprint], ["impactHash", plan.impactHash], ["planHash", plan.planHash], ["proofDefinitionHash", proofDefinitionHash(proof)], ["runnerIdentity", proofRunnerIdentity()], ["environmentPolicyHash", environmentPolicyHash()]])
    if (item[key] !== expected) throw new Error(`EVIDENCE_STALE:${proofId}:${key}`);
  if (item.evidencePayloadHash !== evidencePayloadHash(item)) throw new Error(`EVIDENCE_PAYLOAD_HASH_MISMATCH:${proofId}`);
  if (!validTimeRange(item.startedAt, item.endedAt, now)) throw new Error(`EVIDENCE_TIMESTAMP_INVALID:${proofId}`);
  if (item.attempts.length !== 1) throw new Error(`FLAKY_DETECTED:${proofId}`);
  const expectedPlan = compileRegisteredCommandPlan({ proof, proofId, baseSha: plan.baseSha, headSha: plan.headSha, attemptIndex: 1 });
  if (item.commandPlanHash !== expectedPlan.commandPlanHash || item.attempts[0].commandPlanHash !== expectedPlan.commandPlanHash) throw new Error(`COMMAND_PLAN_MISMATCH:${proofId}`);
  if (item.attempts[0].attemptIndex !== 1 || item.attempts[0].commands.length !== expectedPlan.commands.length) throw new Error(`COMMAND_COUNT_MISMATCH:${proofId}`);
  if (!validTimeRange(item.attempts[0].startedAt, item.attempts[0].endedAt, now)) throw new Error(`ATTEMPT_TIMESTAMP_INVALID:${proofId}`);
  for (let index = 0; index < expectedPlan.commands.length; index += 1) {
    const actual = item.attempts[0].commands[index], expected = expectedPlan.commands[index];
    for (const key of ["attemptIndex", "commandIndex", "executable", "database", "expectedCiJob", "commandIdentity"])
      if (actual[key] !== expected[key]) throw new Error(`COMMAND_IDENTITY_MISMATCH:${proofId}:${index}:${key}`);
    if (JSON.stringify(actual.args) !== JSON.stringify(expected.args)) throw new Error(`COMMAND_ARGUMENT_MISMATCH:${proofId}:${index}`);
    if (actual.exitCode !== 0) throw new Error(`COMMAND_FAILED:${proofId}:${index}`);
    if (!validTimeRange(actual.startedAt, actual.endedAt, now)) throw new Error(`COMMAND_TIMESTAMP_INVALID:${proofId}:${index}`);
    requireOutputRecord(proofId, index, "stdout", actual.stdoutBytes, actual.stdoutHash);
    requireOutputRecord(proofId, index, "stderr", actual.stderrBytes, actual.stderrHash);
  }
  for (const [key, expected] of [["provenanceMode", "GITHUB_ACTIONS"], ["githubRepository", repository], ["githubWorkflow", environment.GITHUB_WORKFLOW], ["githubRunId", environment.GITHUB_RUN_ID], ["githubRunAttempt", environment.GITHUB_RUN_ATTEMPT], ["githubJob", expectedPlan.expectedCiJob], ["githubEvent", environment.GITHUB_EVENT_NAME], ["expectedSourceJob", expectedPlan.expectedCiJob]])
    if (item[key] !== expected) throw new Error(`EVIDENCE_PROVENANCE_MISMATCH:${proofId}:${key}`);
  return { proofId, evidenceHash: sha256(readFileSync(path)) };
};

export const ciProofIds = (plan) => {
  const proofs = readJson("docs/engineering/PROOFS.json").proofs;
  return plan.requiredProofs.filter((proofId) => {
    const proof = proofs.find((candidate) => candidate.id === proofId);
    if (!proof) throw new Error(`PROOF_UNMAPPED:${proofId}`);
    return expectedCiJob(proof) !== "HUMAN_OWNER";
  });
};
const expectedEvidencePaths = (plan) => {
  const proofs = readJson("docs/engineering/PROOFS.json").proofs;
  return new Map(ciProofIds(plan).map((proofId) => {
    const proof = proofs.find((candidate) => candidate.id === proofId);
    const job = expectedCiJob(proof);
    if (!job) throw new Error(`PROOF_SOURCE_JOB_UNMAPPED:${proofId}`);
    return [proofId, resolve(evidenceDirectory, job, `${proofId}.json`)];
  }));
};
const jsonFiles = (directory) => {
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".json")) files.push(path);
    }
  };
  visit(directory);
  return files;
};
export const requireCanonicalEvidenceFiles = (plan) => {
  const expected = expectedEvidencePaths(plan), expectedRelative = [...expected.values()].map((path) => relative(evidenceDirectory, path).replaceAll("\\", "/")).sort();
  const actualRelative = jsonFiles(evidenceDirectory).map((path) => relative(evidenceDirectory, path).replaceAll("\\", "/")).sort();
  if (JSON.stringify(actualRelative) !== JSON.stringify(expectedRelative)) throw new Error(`EVIDENCE_FILE_SET_MISMATCH:${actualRelative.join(",")}`);
  return expected;
};
const requireBundlePath = () => {
  if (!existsSync(attestationDirectory)) throw new Error("ATTESTATION_REQUIRED");
  const files = readdirSync(attestationDirectory, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.jsonl?$/.test(entry.name));
  if (files.length !== 1) throw new Error("ATTESTATION_REQUIRED");
  return resolve(attestationDirectory, files[0].name);
};
const verifyEvidenceAttestation = (path, bundlePath) => {
  const proofId = path.replaceAll("\\", "/").split("/").at(-1).slice(0, -5);
  const result = spawnSync("gh", ["attestation", "verify", path, "--bundle", bundlePath, "--repo", repository, "--signer-workflow", signerWorkflow, "--deny-self-hosted-runners", "--format", "json"], { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 64 << 20 });
  if (result.status !== 0) throw new Error(`ATTESTATION_VERIFICATION_FAILED:${proofId}`);
  return parseVerifiedAttestation({ output: result.stdout, evidenceSha256: sha256(readFileSync(path)), environment: process.env });
};
const certifyRepositoryProof = ({ base, head, expectedJobs }) => {
  if (expectedJobs !== "success:success:success:success:success") throw new Error("CI_JOB_RESULT_INCOMPLETE");
  if (git("rev-parse", "HEAD") !== head) throw new Error("HEAD_MISMATCH");
  if (Number(spawnSync("git", ["merge-base", "--is-ancestor", base, head], { cwd: root }).status) !== 0) throw new Error("BASE_NOT_ANCESTOR");
  const plan = compileProofPlan({ base, head });
  requireCiEnvironment(process.env, plan);
  const paths = requireCanonicalEvidenceFiles(plan), bundlePath = requireBundlePath();
  const proofIds = ciProofIds(plan);
  const attestations = proofIds.map((proofId) => verifyEvidenceAttestation(paths.get(proofId), bundlePath));
  const evidence = proofIds.map((proofId) => validateEvidenceFile({ path: paths.get(proofId), proofId, plan }));
  return { schemaVersion: 1, status: "REPOSITORY_PROOF_READY", headSha: head, treeSha: plan.treeSha, baseSha: base, impactHash: plan.impactHash, planHash: plan.planHash, evidence, attestations, certificateHash: sha256(JSON.stringify({ evidence, attestations })) };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const allowed = new Set(["--base", "--head", "--jobs"]);
  for (let index = 2; index < process.argv.length; index += 2) if (!allowed.has(process.argv[index])) { console.error(`UNKNOWN_ARGUMENT:${process.argv[index]}`); process.exit(2); }
  const { value } = parseArgs();
  try { console.log(JSON.stringify(certifyRepositoryProof({ base: value("--base"), head: value("--head"), expectedJobs: value("--jobs") }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
