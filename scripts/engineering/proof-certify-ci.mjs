import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileRegisteredCommandPlan, proofDefinitionHash, proofRunnerIdentity } from "./proof-command-plan.mjs";
import { evidencePayloadHash, readEvidenceFile } from "./proof-evidence.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { environmentPolicyHash, git, parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";

const canonicalDirectory = resolve(root, "artifacts/engineering-evidence");
const validTimeRange = (startedAt, endedAt, now = Date.now()) => {
  const started = Date.parse(startedAt), ended = Date.parse(endedAt);
  return Number.isFinite(started) && Number.isFinite(ended) && started <= ended && ended <= now + 300_000;
};
const requireCiEnvironment = (environment, plan) => {
  if (environment.CI !== "true") throw new Error("CI_PROVENANCE_REQUIRED");
  const required = ["GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_EVENT_NAME", "KERNEL_BASE_SHA", "KERNEL_HEAD_SHA"];
  if (required.some((key) => !environment[key])) throw new Error("CI_PROVENANCE_INCOMPLETE");
  if (environment.GITHUB_REPOSITORY !== "Deep0202006/CRM_Zero") throw new Error("CI_REPOSITORY_MISMATCH");
  if (environment.KERNEL_BASE_SHA !== plan.baseSha || environment.KERNEL_HEAD_SHA !== plan.headSha) throw new Error("CI_GIT_IDENTITY_MISMATCH");
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
  }
  for (const [key, expected] of [["provenanceMode", "GITHUB_ACTIONS"], ["githubRepository", "Deep0202006/CRM_Zero"], ["githubWorkflow", environment.GITHUB_WORKFLOW], ["githubRunId", environment.GITHUB_RUN_ID], ["githubRunAttempt", environment.GITHUB_RUN_ATTEMPT], ["githubJob", expectedPlan.expectedCiJob], ["githubEvent", environment.GITHUB_EVENT_NAME], ["expectedSourceJob", expectedPlan.expectedCiJob]])
    if (item[key] !== expected) throw new Error(`EVIDENCE_PROVENANCE_MISMATCH:${proofId}:${key}`);
  return { proofId, evidenceHash: sha256(readFileSync(path)) };
};

export const requireCanonicalEvidenceFiles = (plan) => {
  if (!existsSync(canonicalDirectory)) throw new Error("EVIDENCE_DIRECTORY_MISSING");
  const expected = [...plan.requiredProofs].sort(), actual = readdirSync(canonicalDirectory).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`EVIDENCE_FILE_SET_MISMATCH:${actual.join(",")}`);
};
export const certifyRepositoryProof = ({ base, head, expectedJobs, environment = process.env }) => {
  if (expectedJobs !== "success:success:success:success") throw new Error("CI_JOB_RESULT_INCOMPLETE");
  if (git("rev-parse", "HEAD") !== head) throw new Error("HEAD_MISMATCH");
  if (Number(spawnSync("git", ["merge-base", "--is-ancestor", base, head], { cwd: root }).status) !== 0) throw new Error("BASE_NOT_ANCESTOR");
  const plan = compileProofPlan({ base, head });
  requireCiEnvironment(environment, plan);
  requireCanonicalEvidenceFiles(plan);
  const evidence = plan.requiredProofs.map((proofId) => validateEvidenceFile({ path: resolve(canonicalDirectory, `${proofId}.json`), proofId, plan, environment }));
  return { schemaVersion: 1, status: "REPOSITORY_PROOF_READY", headSha: head, treeSha: plan.treeSha, baseSha: base, impactHash: plan.impactHash, planHash: plan.planHash, evidence, certificateHash: sha256(JSON.stringify(evidence)) };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const allowed = new Set(["--base", "--head", "--jobs"]);
  for (let index = 2; index < process.argv.length; index += 2) if (!allowed.has(process.argv[index])) { console.error(`UNKNOWN_ARGUMENT:${process.argv[index]}`); process.exit(2); }
  const { value } = parseArgs();
  try { console.log(JSON.stringify(certifyRepositoryProof({ base: value("--base"), head: value("--head"), expectedJobs: value("--jobs") }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
