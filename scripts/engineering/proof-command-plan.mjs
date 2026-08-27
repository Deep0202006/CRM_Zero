import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { root, sha256 } from "./kernel-lib.mjs";

const jobByKind = Object.freeze({
  unit: "preflight",
  build: "unit-build",
  postgres: "receivables-postgres",
  e2e: "e2e",
  handover: "preflight",
  "owner-pre": "HUMAN_OWNER",
  "owner-post": "HUMAN_OWNER",
});

export const expectedCiJob = (proof) => proof.expectedCiJob ?? jobByKind[proof.kind];
export const proofDefinitionHash = (proof) => sha256(JSON.stringify(proof));
export const proofRunnerIdentity = () => sha256([
  "scripts/engineering/proof-runner.mjs",
  "scripts/engineering/proof-command-plan.mjs",
  "scripts/engineering/proof-evidence.mjs",
].map((path) => `${path}:${sha256(readFileSync(resolve(root, path)))}`).join("\n"));

const expand = (value, identity) => String(value).replaceAll("$BASE_SHA", identity.baseSha).replaceAll("$HEAD_SHA", identity.headSha);
const rawCommands = (proof) => {
  if (proof.commands) return proof.commands;
  if (proof.runner === "node") return proof.paths.map((path) => ({ file: "node", args: [path] }));
  if (proof.runner === "jest") return [{ file: "npx", args: ["jest", "--runInBand", ...proof.paths] }];
  if (proof.runner === "playwright") return [{ file: "npx", args: ["playwright", "test", ...proof.paths, "--retries=0", "--trace=on-first-retry"] }];
  if (proof.runner === "bash-postgres") return proof.paths.map((path, index) => ({ file: "bash", args: [path], databaseIndex: index }));
  if (proof.runner === "owner-sql") throw new Error(`HUMAN_APPROVAL_REQUIRED:${proof.id}`);
  throw new Error(`PROOF_RUNNER_UNSUPPORTED:${proof.id}`);
};
export const compileRegisteredCommandPlan = ({ proof, proofId = proof?.id, baseSha, headSha, attemptIndex = 1 }) => {
  if (!proof || proof.id !== proofId) throw new Error(`PROOF_DEFINITION_MISMATCH:${proofId}`);
  if (!Number.isInteger(attemptIndex) || attemptIndex < 1 || attemptIndex > 2) throw new Error("PROOF_ATTEMPT_INVALID");
  const sourceJob = expectedCiJob(proof);
  if (!sourceJob) throw new Error(`PROOF_SOURCE_JOB_UNMAPPED:${proofId}`);
  const commands = [];
  for (const command of rawCommands(proof)) {
    const database = command.databaseIndex === undefined ? null : `kernel_${proofId.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${headSha.slice(0, 8)}_${command.databaseIndex}_a${attemptIndex}`.slice(0, 63);
    if (database) commands.push({ executable: "createdb", args: [database], database: null });
    commands.push({ executable: expand(command.file, { baseSha, headSha }), args: command.args.map((value) => expand(value, { baseSha, headSha })), database });
  }
  const ordered = commands.map((command, commandIndex) => {
    const identity = { proofId, baseSha, headSha, attemptIndex, commandIndex, expectedCiJob: sourceJob, ...command };
    return { attemptIndex, commandIndex, expectedCiJob: sourceJob, ...command, commandIdentity: sha256(JSON.stringify(identity)) };
  });
  const plan = { schemaVersion: 1, proofId, baseSha, headSha, attemptIndex, expectedCiJob: sourceJob, commands: ordered };
  return { ...plan, commandPlanHash: sha256(JSON.stringify(plan)) };
};
