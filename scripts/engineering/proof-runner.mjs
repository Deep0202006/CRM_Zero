import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileRegisteredCommandPlan, disposablePostgresEnvironment, expectedCiJob, proofDefinitionHash, proofInputIdentity, proofRunnerIdentity, validateCommandPlan } from "./proof-command-plan.mjs";
import { evidencePayloadHash, provenanceFromEnvironment, readEvidenceFile } from "./proof-evidence.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { dirtyFingerprint, environmentPolicyHash, git, parseArgs, readJson, root, run, safeEnvironment, sha256 } from "./kernel-lib.mjs";

const executionDiagnostics = new Map(), postgresImage = "postgres:17.6";
const boundedDiagnostic = (stdout, stderr) => {
  const combined = `${stdout}\n${stderr}`, semantic = combined.split(/\r?\n/).filter((line) => !/\bwarning\b/i.test(line) && /(?:error|fail|assert|timeout|timed out|expected|received|constraint|enoent)/i.test(line)).slice(-8).join("\n");
  const redacted = `${semantic}${semantic ? "\n" : ""}${combined}`.replace(/\b(token|password|secret|authorization|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
  return redacted.length <= 2048 ? redacted : `${redacted.slice(0, 1024)}\n...\n${redacted.slice(-1018)}`;
};
export const canonicalEvidencePath = (proofId, sourceJob) => {
  sourceJob ??= expectedCiJob(readJson("docs/engineering/PROOFS.json").proofs.find((proof) => proof.id === proofId));
  if (!sourceJob) throw new Error(`PROOF_SOURCE_JOB_UNMAPPED:${proofId}`);
  return resolve(root, "artifacts/engineering-evidence", sourceJob, `${proofId}.json`);
};
export const commonEvidencePath = (proofId, headSha) => resolve(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "zd-os/proof-evidence", proofId, `${headSha}.json`);
export const writeReuseEvidence = ({ proof, source, plan, incrementalImpactHash, reuseDecisionHash }) => {
  const input = proofInputIdentity(proof), now = new Date().toISOString(), sourceJob = expectedCiJob(proof);
  const evidence = {
    schemaVersion: 3, proofId: proof.id, kind: proof.kind, status: "REUSED", baseSha: plan.baseSha, headSha: plan.headSha, treeSha: plan.treeSha,
    dirtyFingerprint: plan.dirtyFingerprint, impactHash: plan.impactHash, planHash: plan.planHash, proofDefinitionHash: proofDefinitionHash(proof), proofInputHash: input.proofInputHash,
    runnerIdentity: proofRunnerIdentity(), commandPlanHash: source.commandPlanHash, environmentPolicyHash: environmentPolicyHash(), startedAt: now, endedAt: now, attempts: [],
    ...provenanceFromEnvironment(process.env, sourceJob), sourceEvidenceHash: source.evidencePayloadHash, sourceHeadSha: source.headSha, currentHeadSha: plan.headSha, incrementalImpactHash, reuseDecisionHash,
  };
  evidence.evidencePayloadHash = evidencePayloadHash(evidence);
  const canonical = canonicalEvidencePath(proof.id, sourceJob); if (existsSync(canonical)) rmSync(canonical, { force: true }); atomicWriteEvidence(canonical, evidence);
  return evidence;
};
export const proofExecutionEnvironment = (kind, command, source = process.env) => kind === "postgres" ? disposablePostgresEnvironment(command, source) : { ...safeEnvironment(source), ...(kind === "e2e" ? { PLAYWRIGHT_REUSE_EXISTING_SERVER: "false" } : {}) };

export const detectPostgresBackend = ({ runner = run } = {}) => {
  const bash = runner("bash", ["--version"]), native = runner("pg_isready", ["-h", "127.0.0.1", "-p", "5432", "-U", "postgres"]);
  if (bash.status === 0 && native.status === 0) return { status: "AVAILABLE", backend: "native" };
  const docker = runner("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return docker.status === 0 ? { status: "AVAILABLE", backend: "docker", version: String(docker.stdout ?? "").trim() } : { status: "REMOTE_ONLY_POSTGRES", backend: null, reason: "NATIVE_AND_DOCKER_UNAVAILABLE" };
};

const dockerBackend = ({ runner = run } = {}) => {
  const suffix = sha256(`${process.pid}:${Date.now()}:${Math.random()}`).slice(0, 12), network = `crm-proof-${suffix}`, server = `crm-pg-${suffix}`, hostEnvironment = safeEnvironment();
  const invoke = (args) => runner("docker", args, { env: hostEnvironment });
  if (invoke(["network", "create", network]).status !== 0) throw new Error("POSTGRES_DOCKER_NETWORK_FAILED");
  try {
    const started = invoke(["run", "-d", "--name", server, "--network", network, "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_PASSWORD=postgres", "-e", "POSTGRES_DB=postgres", postgresImage]);
    if (started.status !== 0) throw new Error("POSTGRES_DOCKER_START_FAILED");
    let ready = false;
    for (let count = 0; count < 40; count += 1) {
      if (invoke(["exec", server, "pg_isready", "-U", "postgres", "-d", "postgres"]).status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    if (!ready) throw new Error("POSTGRES_DOCKER_NOT_READY");
    const mount = `${root.replaceAll("\\", "/")}:/workspace`;
    return {
      backend: "docker",
      execute: (command) => invoke(["run", "--rm", "--network", network, "-e", `PGHOST=${server}`, "-e", "PGPORT=5432", "-e", "PGUSER=postgres", "-e", "PGPASSWORD=postgres", "-e", `PGDATABASE=${command.database ?? "postgres"}`, "-e", "PGSSLMODE=disable", "-e", "CRM_MASTER_DB_DISPOSABLE=1", "-e", "CRM_POSTGRES_SERVICE_DISPOSABLE=1", "-v", mount, "-w", "/workspace", postgresImage, command.executable, ...command.args]),
      cleanup: () => { invoke(["rm", "-f", server]); invoke(["network", "rm", network]); },
    };
  } catch (error) { invoke(["rm", "-f", server]); invoke(["network", "rm", network]); throw error; }
};
const nativeBackend = ({ runner = run } = {}) => {
  const databases = new Set();
  return { backend: "native", execute: (command) => { if (command.databaseName) databases.add(command.databaseName); return runner(command.executable, command.args, { env: proofExecutionEnvironment("postgres", command) }); }, cleanup: () => { for (const database of databases) runner("dropdb", ["--if-exists", database], { env: disposablePostgresEnvironment({ database: "postgres" }) }); } };
};
export const createPostgresBackend = ({ runner = run, capability = detectPostgresBackend({ runner }) } = {}) => capability.backend === "native" ? nativeBackend({ runner }) : capability.backend === "docker" ? dockerBackend({ runner }) : null;

export const executeAttempt = (commandPlan, kind, { runner = run } = {}) => {
  const startedAt = new Date().toISOString(), commands = [], backend = kind === "postgres" ? createPostgresBackend({ runner }) : null;
  if (kind === "postgres" && !backend) throw new Error("REMOTE_ONLY_POSTGRES");
  try {
    for (const command of commandPlan.commands) {
      const commandStartedAt = new Date().toISOString(), processResult = backend ? backend.execute(command) : runner(command.executable, command.args, { env: proofExecutionEnvironment(kind, command) }), stdout = processResult.stdout ?? "", stderr = processResult.stderr ?? String(processResult.error ?? "");
      const record = { ...command, exitCode: processResult.status ?? 1, stdoutHash: sha256(stdout), stdoutBytes: Buffer.byteLength(stdout), stderrHash: sha256(stderr), stderrBytes: Buffer.byteLength(stderr), startedAt: commandStartedAt, endedAt: new Date().toISOString() };
      if (record.exitCode !== 0) executionDiagnostics.set(record.commandIdentity, boundedDiagnostic(stdout, record.phase === "fixture" ? `FIXTURE_INVALID_BEFORE_ASSERTION\n${stderr}` : stderr));
      commands.push(record); if (record.exitCode !== 0) break;
    }
  } finally { backend?.cleanup(); }
  return { attemptIndex: 1, commandPlanHash: commandPlan.commandPlanHash, startedAt, endedAt: new Date().toISOString(), commands };
};
const atomicWriteEvidence = (path, evidence, { immutable = false } = {}) => {
  if (immutable && existsSync(path)) {
    const existing = readEvidenceFile(path); if (existing.evidencePayloadHash !== evidence.evidencePayloadHash) throw new Error(`EVIDENCE_IMMUTABILITY_CONFLICT:${evidence.proofId}`); return;
  }
  mkdirSync(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; const handle = openSync(temp, "wx", 0o600);
  try { writeFileSync(handle, `${JSON.stringify(evidence, null, 2)}\n`); fsyncSync(handle); } finally { closeSync(handle); }
  try { renameSync(temp, path); } catch (error) { if (existsSync(temp)) unlinkSync(temp); throw error; }
};
const requireCiRunnerIdentity = (plan, sourceJob) => {
  if (process.env.CI !== "true") return;
  const required = ["GITHUB_REPOSITORY", "GITHUB_WORKFLOW", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_EVENT_NAME", "KERNEL_BASE_SHA", "KERNEL_HEAD_SHA"];
  if (process.env.GITHUB_ACTIONS !== "true" || required.some((key) => !process.env[key])) throw new Error("CI_PROVENANCE_INCOMPLETE");
  if (process.env.GITHUB_REPOSITORY !== "Deep0202006/CRM_Zero") throw new Error("CI_REPOSITORY_MISMATCH");
  if (process.env.GITHUB_JOB !== sourceJob) throw new Error(`CI_SOURCE_JOB_MISMATCH:${sourceJob}`);
  if (process.env.KERNEL_BASE_SHA !== plan.baseSha || process.env.KERNEL_HEAD_SHA !== plan.headSha) throw new Error("CI_GIT_IDENTITY_MISMATCH");
};

export const runRegisteredProof = ({ proofId, base = "origin/main", head = "WORKTREE", plan, runner = run } = {}) => {
  plan ??= compileProofPlan({ base, head, requestedProofIds: [proofId] }); validateCommandPlan({ plan });
  const proof = readJson("docs/engineering/PROOFS.json").proofs.find((item) => item.id === proofId); if (!proof) throw new Error(`PROOF_UNMAPPED:${proofId}`); if (!plan.requiredProofs.includes(proofId)) throw new Error(`PROOF_NOT_REQUIRED:${proofId}`);
  const input = proofInputIdentity(proof), commandPlan = compileRegisteredCommandPlan({ proof, proofId, baseSha: plan.baseSha, headSha: plan.headSha, proofInputHash: input.proofInputHash }); requireCiRunnerIdentity(plan, commandPlan.expectedCiJob);
  const startedAt = new Date().toISOString(), attempt = executeAttempt(commandPlan, proof.kind, { runner }), passed = attempt.commands.length === commandPlan.commands.length && attempt.commands.every((command) => command.exitCode === 0);
  const evidence = { schemaVersion: 3, proofId, kind: proof.kind, status: passed ? "PASS" : "FAIL", baseSha: plan.baseSha, headSha: plan.headSha, treeSha: plan.treeSha, dirtyFingerprint: dirtyFingerprint(), impactHash: plan.impactHash, planHash: plan.planHash, proofDefinitionHash: proofDefinitionHash(proof), proofInputHash: input.proofInputHash, runnerIdentity: proofRunnerIdentity(), commandPlanHash: commandPlan.commandPlanHash, environmentPolicyHash: environmentPolicyHash(), startedAt, endedAt: new Date().toISOString(), attempts: [attempt], ...provenanceFromEnvironment(process.env, commandPlan.expectedCiJob) };
  evidence.evidencePayloadHash = evidencePayloadHash(evidence); const canonical = canonicalEvidencePath(proofId, commandPlan.expectedCiJob); if (existsSync(canonical)) rmSync(canonical, { force: true }); atomicWriteEvidence(canonical, evidence); if (passed && evidence.provenanceMode === "LOCAL") atomicWriteEvidence(commonEvidencePath(proofId, plan.headSha), evidence, { immutable: true }); return evidence;
};
export const proofFailureDiagnostics = (evidence) => evidence.attempts.flatMap((attempt) => attempt.commands.filter((command) => command.exitCode !== 0).map((command) => executionDiagnostics.get(command.commandIdentity) ?? "NO_DIAGNOSTIC"));

export const diagnoseProof = ({ proofId, runner = run } = {}) => {
  const path = canonicalEvidencePath(proofId), evidence = readEvidenceFile(path); if (evidence.status !== "FAIL") throw new Error(`PROOF_DIAGNOSIS_REQUIRES_FAIL:${proofId}`); if (evidence.kind === "postgres") throw new Error("DIAGNOSIS_UNSAFE_DATABASE_SETUP_REQUIRED");
  const failed = evidence.attempts[0].commands.find((command) => command.exitCode !== 0); if (!failed) throw new Error("PROOF_FAILED_COMMAND_MISSING");
  const result = runner(failed.executable, failed.args, { env: proofExecutionEnvironment(evidence.kind, failed) }), status = result.status === 0 ? "FLAKY_DETECTED" : "FAIL";
  return { schemaVersion: 1, proofId, status, sourceEvidenceHash: evidence.evidencePayloadHash, commandIdentity: failed.commandIdentity, diagnosticHash: sha256(JSON.stringify([result.status, result.stdout, result.stderr])), diagnosedAt: new Date().toISOString() };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const allowed = new Set(["--base", "--head", "--proof", "--kind", "--diagnose"]); for (let index = 2; index < process.argv.length; index += 1) if (process.argv[index].startsWith("--") && !allowed.has(process.argv[index])) { console.error(`UNKNOWN_ARGUMENT:${process.argv[index]}`); process.exit(2); }
  const args = parseArgs(), base = args.value("--base", "origin/main"), head = args.value("--head", "WORKTREE"), proofId = args.value("--proof"), kind = args.value("--kind");
  try {
    if (args.has("--diagnose")) console.log(JSON.stringify(diagnoseProof({ proofId, base, head }), null, 2));
    else {
      const plan = compileProofPlan({ base, head, requestedProofIds: proofId ? [proofId] : [] }), selected = [...new Set([...(proofId ? [proofId] : []), ...(kind ? plan.requiredByKind[kind] ?? [] : [])])]; validateCommandPlan({ plan });
      if (!selected.length) { if (kind && plan.notRequiredKinds.includes(kind)) { console.log(JSON.stringify({ kind, status: "NOT_REQUIRED", planHash: plan.planHash })); process.exit(0); } throw new Error("PROOF_UNMAPPED"); }
      const results = selected.map((id) => runRegisteredProof({ proofId: id, base, head, plan })); for (const result of results.filter((item) => item.status !== "PASS")) for (const command of result.attempts[0].commands.filter((item) => item.exitCode !== 0)) console.error(`PROOF_COMMAND_FAILED:${result.proofId}:command=${command.commandIndex}:${command.executable} ${command.args.join(" ")}\n${executionDiagnostics.get(command.commandIdentity) ?? "NO_DIAGNOSTIC"}`); console.log(JSON.stringify(results, null, 2)); if (results.some((item) => item.status !== "PASS")) process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
