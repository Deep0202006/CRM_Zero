import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProofPlan } from "./proof-plan.mjs";
import { environmentPolicyHash, git, parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";

export const validateEvidenceItem = (item, proofId, plan) => {
  for (const [key, expected] of [["proofId", proofId], ["status", "PASS"], ["headSha", plan.headSha], ["treeSha", plan.treeSha], ["baseSha", plan.baseSha], ["dirtyFingerprint", plan.dirtyFingerprint], ["impactHash", plan.impactHash], ["planHash", plan.planHash]]) if (item[key] !== expected) throw new Error(`EVIDENCE_STALE:${proofId}:${key}`);
  const proof = readJson("docs/engineering/PROOFS.json").proofs.find((candidate) => candidate.id === proofId);
  const expectedRunner = sha256(readFileSync(resolve(root, "scripts/engineering/proof-runner.mjs")));
  for (const [key, expected] of [["runnerIdentity", expectedRunner], ["environmentPolicyHash", environmentPolicyHash()], ["proofDefinitionHash", sha256(JSON.stringify(proof))]]) if (item[key] !== expected) throw new Error(`EVIDENCE_STALE:${proofId}:${key}`);
  if (item.attempts?.length !== 1 || !item.attempts[0]?.length || item.attempts[0].some((result) => result.exitCode !== 0 || !/^[a-f0-9]{64}$/.test(result.commandIdentity) || !/^[a-f0-9]{64}$/.test(result.stdoutHash) || !/^[a-f0-9]{64}$/.test(result.stderrHash))) throw new Error(`EVIDENCE_INCOMPLETE:${proofId}`);
  return true;
};
export const requireEvidenceFiles = (plan, evidenceDirectory) => {
  for (const proofId of plan.requiredProofs) if (!existsSync(resolve(evidenceDirectory, `${proofId}.json`))) throw new Error(`EVIDENCE_MISSING:${proofId}`);
  return true;
};

export const certifyRepositoryProof = ({ base, head, evidenceDirectory, expectedJobs }) => {
  if (expectedJobs !== "success:success:success:success") throw new Error("CI_JOB_RESULT_INCOMPLETE");
  if (git("rev-parse", "HEAD") !== head) throw new Error("HEAD_MISMATCH");
  const contained = Number(spawnSync("git", ["merge-base", "--is-ancestor", base, head], { cwd: root }).status);
  if (contained !== 0) throw new Error("BASE_NOT_ANCESTOR");
  const plan = compileProofPlan({ base, head }), evidence = [];
  requireEvidenceFiles(plan, resolve(root, evidenceDirectory));
  for (const proofId of plan.requiredProofs) {
    const path = resolve(root, evidenceDirectory, `${proofId}.json`);
    if (!existsSync(path)) throw new Error(`EVIDENCE_MISSING:${proofId}`);
    const item = JSON.parse(readFileSync(path, "utf8"));
    validateEvidenceItem(item, proofId, plan);
    evidence.push({ proofId, evidenceHash: sha256(readFileSync(path)) });
  }
  return { schemaVersion: 1, status: "REPOSITORY_PROOF_READY", headSha: head, treeSha: plan.treeSha, baseSha: base, impactHash: plan.impactHash, planHash: plan.planHash, evidence, certificateHash: sha256(JSON.stringify(evidence)) };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { value } = parseArgs();
  try { console.log(JSON.stringify(certifyRepositoryProof({ base: value("--base"), head: value("--head"), evidenceDirectory: value("--evidence-dir", "artifacts/engineering-evidence"), expectedJobs: value("--jobs") }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
