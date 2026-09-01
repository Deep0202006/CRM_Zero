import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileRegisteredCommandPlan, disposablePostgresEnvironment, expectedCiJob, proofDefinitionHash, proofRunnerIdentity } from "./proof-command-plan.mjs";
import { evidencePayloadHash, provenanceFromEnvironment } from "./proof-evidence.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { dirtyFingerprint, environmentPolicyHash, parseArgs, readJson, root, run, safeEnvironment, sha256 } from "./kernel-lib.mjs";

const executionDiagnostics = new Map();
const boundedDiagnostic = (value) => {
  const redacted = String(value).replace(/\b(token|password|secret|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  return redacted.length <= 2048 ? redacted : `${redacted.slice(-1530)}\n...\n${redacted.slice(0, 512)}`;
};
export const canonicalEvidencePath = (proofId, sourceJob) => {
  sourceJob ??= expectedCiJob(readJson("docs/engineering/PROOFS.json").proofs.find((proof) => proof.id === proofId));
  if (!sourceJob) throw new Error(`PROOF_SOURCE_JOB_UNMAPPED:${proofId}`);
  return resolve(root, "artifacts/engineering-evidence", sourceJob, `${proofId}.json`);
};
export const proofExecutionEnvironment = (kind, command, source = process.env) => kind === "postgres" ? disposablePostgresEnvironment(command, source) : { ...safeEnvironment(source), ...(kind === "e2e" ? { PLAYWRIGHT_REUSE_EXISTING_SERVER: "false" } : {}) };
const executeAttempt = (commandPlan, kind) => {
  const startedAt = new Date().toISOString(), commands = [];
  for (const command of commandPlan.commands) {
    const commandStartedAt = new Date().toISOString();
    const environment = proofExecutionEnvironment(kind, command);
    const processResult = run(command.executable, command.args, { env: environment });
    const stdout = processResult.stdout ?? "", stderr = processResult.stderr ?? String(processResult.error ?? "");
    const record = {
      ...command,
      exitCode: processResult.status ?? 1,
      stdoutHash: sha256(stdout),
      stdoutBytes: Buffer.byteLength(stdout),
      stderrHash: sha256(stderr),
      stderrBytes: Buffer.byteLength(stderr),
      startedAt: commandStartedAt,
      endedAt: new Date().toISOString(),
    };
    if (record.exitCode !== 0) executionDiagnostics.set(record.commandIdentity, boundedDiagnostic(`${stdout}\n${stderr}`));
    commands.push(record);
    if (record.exitCode !== 0) break;
  }
  return { attemptIndex: commandPlan.attemptIndex, commandPlanHash: commandPlan.commandPlanHash, startedAt, endedAt: new Date().toISOString(), commands };
};
const atomicCreateEvidence = (path, evidence) => {
  if (existsSync(path)) throw new Error(`EVIDENCE_ALREADY_EXISTS:${evidence.proofId}`);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  const handle = openSync(temp, "wx", 0o600);
  try { writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`); fsyncSync(handle); }
  finally { closeSync(handle); }
  try { renameSync(temp, path); }
  catch (error) { if (existsSync(temp)) unlinkSync(temp); throw error; }
};
const requireCiRunnerIdentity = (plan, sourceJob) => {
  if (process.env.CI !== "true") return;
  const required = ["GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_EVENT_NAME", "KERNEL_BASE_SHA", "KERNEL_HEAD_SHA"];
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("CI_PROVENANCE_INCOMPLETE");
  if (required.some((key) => !process.env[key])) throw new Error("CI_PROVENANCE_INCOMPLETE");
  if (process.env.GITHUB_REPOSITORY !== "Deep0202006/CRM_Zero") throw new Error("CI_REPOSITORY_MISMATCH");
  if (process.env.GITHUB_JOB !== sourceJob) throw new Error(`CI_SOURCE_JOB_MISMATCH:${sourceJob}`);
  if (process.env.KERNEL_BASE_SHA !== plan.baseSha || process.env.KERNEL_HEAD_SHA !== plan.headSha) throw new Error("CI_GIT_IDENTITY_MISMATCH");
};

export const runRegisteredProof = ({ proofId, base = "origin/main", head = "WORKTREE", plan } = {}) => {
  plan ??= compileProofPlan({ base, head });
  const proof = readJson("docs/engineering/PROOFS.json").proofs.find((item) => item.id === proofId);
  if (!proof) throw new Error(`PROOF_UNMAPPED:${proofId}`);
  if (!plan.requiredProofs.includes(proofId)) throw new Error(`PROOF_NOT_REQUIRED:${proofId}`);
  const firstPlan = compileRegisteredCommandPlan({ proof, proofId, baseSha: plan.baseSha, headSha: plan.headSha, attemptIndex: 1 });
  requireCiRunnerIdentity(plan, firstPlan.expectedCiJob);
  const startedAt = new Date().toISOString(), first = executeAttempt(firstPlan, proof.kind);
  const firstPassed = first.commands.length === firstPlan.commands.length && first.commands.every((command) => command.exitCode === 0);
  const attempts = [first];
  const secondPlan = firstPassed ? null : compileRegisteredCommandPlan({ proof, proofId, baseSha: plan.baseSha, headSha: plan.headSha, attemptIndex: 2 });
  if (secondPlan) attempts.push(executeAttempt(secondPlan, proof.kind));
  const retryPassed = secondPlan && attempts[1].commands.length === secondPlan.commands.length && attempts[1].commands.every((command) => command.exitCode === 0);
  const evidence = {
    schemaVersion: 2,
    proofId,
    kind: proof.kind,
    status: firstPassed ? "PASS" : retryPassed ? "FLAKY_DETECTED" : "FAIL",
    baseSha: plan.baseSha,
    headSha: plan.headSha,
    treeSha: plan.treeSha,
    dirtyFingerprint: dirtyFingerprint(),
    impactHash: plan.impactHash,
    planHash: plan.planHash,
    proofDefinitionHash: proofDefinitionHash(proof),
    runnerIdentity: proofRunnerIdentity(),
    commandPlanHash: firstPlan.commandPlanHash,
    environmentPolicyHash: environmentPolicyHash(),
    startedAt,
    endedAt: new Date().toISOString(),
    attempts,
    ...provenanceFromEnvironment(process.env, firstPlan.expectedCiJob),
  };
  evidence.evidencePayloadHash = evidencePayloadHash(evidence);
  atomicCreateEvidence(canonicalEvidencePath(proofId, firstPlan.expectedCiJob), evidence);
  return evidence;
};

export const proofFailureDiagnostics = (evidence) => evidence.attempts.flatMap((attempt) => attempt.commands.filter((command) => command.exitCode !== 0).map((command) => executionDiagnostics.get(command.commandIdentity) ?? "NO_DIAGNOSTIC"));

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const allowed = new Set(["--base", "--head", "--proof", "--kind"]);
  for (let index = 2; index < process.argv.length; index += 2) if (!allowed.has(process.argv[index])) { console.error(`UNKNOWN_ARGUMENT:${process.argv[index]}`); process.exit(2); }
  const { value } = parseArgs(), base = value("--base", "origin/main"), head = value("--head", "WORKTREE"), proofId = value("--proof"), kind = value("--kind");
  try {
    const plan = compileProofPlan({ base, head });
    const selected = [...new Set([...(proofId ? [proofId] : []), ...(kind ? plan.requiredByKind[kind] ?? [] : [])])];
    if (!selected?.length) {
      if (kind && plan.notRequiredKinds.includes(kind)) { console.log(JSON.stringify({ kind, status: "NOT_REQUIRED", planHash: plan.planHash })); process.exit(0); }
      throw new Error("PROOF_UNMAPPED");
    }
    const results = selected.map((id) => runRegisteredProof({ proofId: id, base, head, plan }));
    for (const result of results.filter((item) => item.status !== "PASS")) for (const attempt of result.attempts) for (const command of attempt.commands.filter((item) => item.exitCode !== 0)) console.error(`PROOF_COMMAND_FAILED:${result.proofId}:attempt=${attempt.attemptIndex}:command=${command.commandIndex}:${command.executable} ${command.args.join(" ")}\n${executionDiagnostics.get(command.commandIdentity) ?? "NO_DIAGNOSTIC"}`);
    console.log(JSON.stringify(results, null, 2));
    if (results.some((item) => item.status !== "PASS")) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
