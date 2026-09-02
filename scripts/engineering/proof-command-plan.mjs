import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSourceIndex } from "./source-index.mjs";
import { root, safeEnvironment, sha256 } from "./kernel-lib.mjs";

export const POSTGRES_SERVICE_PORT = "5432";
const expensiveKinds = new Set(["build", "postgres", "e2e"]), postgresKeys = new Set(["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGDATABASE"]);
const matches = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const registry = () => JSON.parse(readFileSync(resolve(root, "docs/engineering/PROOFS.json"), "utf8"));
const ciRoutes = () => JSON.parse(readFileSync(resolve(root, "docs/engineering/CI_PROOF_JOBS.json"), "utf8")).routes;

export const assertDisposablePostgresEnvironment = (command, environment) => {
  const expectedDatabase = command.database ?? "postgres";
  if (!["127.0.0.1", "localhost"].includes(environment.PGHOST) || environment.PGPORT !== POSTGRES_SERVICE_PORT || environment.PGUSER !== "postgres" || environment.PGPASSWORD !== "postgres" || environment.PGSSLMODE !== "disable" || environment.PGDATABASE !== expectedDatabase || environment.CRM_MASTER_DB_DISPOSABLE !== "1" || environment.CRM_POSTGRES_SERVICE_DISPOSABLE !== "1") throw new Error("POSTGRES_DISPOSABLE_ENVIRONMENT_INVALID");
  if (Object.keys(environment).some((key) => /^PG[A-Z0-9_]*$/i.test(key) && !postgresKeys.has(key.toUpperCase()))) throw new Error("POSTGRES_CONNECTION_VARIABLE_SURVIVED");
  return environment;
};
export const disposablePostgresEnvironment = (command, source = process.env) => assertDisposablePostgresEnvironment(command, {
  ...safeEnvironment(source), PGHOST: "127.0.0.1", PGPORT: POSTGRES_SERVICE_PORT, PGUSER: "postgres", PGPASSWORD: "postgres", PGSSLMODE: "disable", PGDATABASE: command.database ?? "postgres", CRM_MASTER_DB_DISPOSABLE: "1", CRM_POSTGRES_SERVICE_DISPOSABLE: "1",
});

export const expectedCiJob = (proof) => proof.expectedCiJob ?? ciRoutes().find((route) => route.kind === proof.kind)?.job;
export const proofDefinitionHash = (proof) => sha256(JSON.stringify(proof));
export const validateProofCiParity = ({ proofs, workflow }) => {
  const jobs = new Set([...String(workflow).matchAll(/^  ([a-z][a-z0-9-]+):\s*$/gm)].map((match) => match[1])), routes = ciRoutes(), failures = [];
  for (const proof of proofs) {
    const route = routes.filter((item) => item.kind === proof.kind);
    if (route.length !== 1) failures.push(`PROOF_SOURCE_JOB_UNMAPPED:${proof.id}`);
    else if (route[0].job !== "HUMAN_OWNER" && !jobs.has(route[0].job)) failures.push(`PROOF_CI_JOB_MISSING:${proof.id}:${route[0].job}`);
  }
  const activeKinds = new Set(proofs.map((proof) => proof.kind));
  for (const route of routes.filter((item) => item.job !== "HUMAN_OWNER" && activeKinds.has(item.kind))) if (!String(workflow).includes(`--kind ${route.kind}`)) failures.push(`PROOF_CI_KIND_MISSING:${route.kind}`);
  const result = { status: failures.length ? "FAIL" : "PASS", failures, jobs: [...jobs].sort(), routes };
  result.parityHash = sha256(JSON.stringify(result));
  return result;
};
export const proofRunnerIdentity = () => sha256(["scripts/engineering/proof-runner.mjs", "scripts/engineering/proof-command-plan.mjs", "scripts/engineering/proof-evidence.mjs"].map((path) => `${path}:${sha256(readFileSync(resolve(root, path)))}`).join("\n"));

const repoPath = (value) => /^(?:src|scripts|e2e|docs|supabase|\.github|\.codex)\//.test(value) || /^(?:package(?:-lock)?\.json|playwright\.config\.ts|jest\.config\.ts|next\.config\.ts|tsconfig\.json)$/.test(value);
export const proofInputPaths = (proof, { index = buildSourceIndex({ writeCache: false }) } = {}) => {
  const proofRegistry = registry(), domainRegistry = JSON.parse(readFileSync(resolve(root, "docs/engineering/DOMAIN_MAP.json"), "utf8")), patterns = new Set([...(proof.paths ?? []), ...(proof.inputs ?? []), ...(proof.commands ?? []).flatMap((command) => command.args.filter(repoPath)), ...(proofRegistry.globalInvalidators?.[proof.kind] ?? []), "docs/engineering/PROOFS.json", "docs/engineering/CI_PROOF_JOBS.json", "scripts/engineering/proof-runner.mjs", "scripts/engineering/proof-command-plan.mjs", "scripts/engineering/proof-evidence.mjs"]);
  for (const domain of domainRegistry.domains.filter((item) => (proof.domains ?? []).includes(item.id))) for (const pattern of [...(domain.codeRoots ?? []), ...(domain.serverBoundaries ?? []), ...(domain.contractPaths ?? []), ...(domain.pathPatterns ?? []), ...(domain.criticalTests ?? [])]) patterns.add(pattern);
  const selected = new Set(index.files.filter((file) => [...patterns].some((pattern) => matches(file.path, pattern))).map((file) => file.path));
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const path of [...selected]) {
      const absolute = resolve(root, path); if (!existsSync(absolute)) continue;
      const refs = readFileSync(absolute, "utf8").match(/(?:src|scripts|e2e|docs|supabase|\.github|\.codex)\/[A-Za-z0-9_.\[\]/-]+/g) ?? [];
      for (const ref of refs) if (index.files.some((file) => file.path === ref) && !selected.has(ref)) { selected.add(ref); changed = true; }
    }
    if (!changed) break;
  }
  return [...selected].sort();
};
export const proofInputIdentity = (proof, options = {}) => {
  const paths = proofInputPaths(proof, options), records = paths.map((path) => [path, sha256(readFileSync(resolve(root, path)))]);
  return { paths, proofInputHash: sha256(JSON.stringify({ proof: proofDefinitionHash(proof), records })) };
};

const expand = (value, identity) => String(value).replaceAll("$BASE_SHA", identity.baseSha).replaceAll("$HEAD_SHA", identity.headSha);
const rawCommands = (proof) => {
  if (proof.databasePhases) return ["schema", "fixture", "assertion"].flatMap((phase) => (proof.databasePhases[phase] ?? []).map((command) => ({ ...command, phase, databaseIndex: 0 })));
  if (proof.commands) return proof.commands;
  if (proof.runner === "node") return proof.paths.map((path) => ({ file: "node", args: [path] }));
  if (proof.runner === "jest") return [{ file: "npx", args: ["jest", "--runInBand", ...proof.paths] }];
  if (proof.runner === "playwright") return [{ file: "npx", args: ["playwright", "test", ...proof.paths, "--retries=0", "--trace=retain-on-failure"] }];
  if (proof.runner === "bash-postgres") return proof.paths.map((path, databaseIndex) => ({ file: "bash", args: [path], databaseIndex, phase: "assertion" }));
  if (proof.runner === "owner-sql") throw new Error(`HUMAN_APPROVAL_REQUIRED:${proof.id}`);
  throw new Error(`PROOF_RUNNER_UNSUPPORTED:${proof.id}`);
};
export const compileRegisteredCommandPlan = ({ proof, proofId = proof?.id, baseSha, headSha, proofInputHash = proofInputIdentity(proof).proofInputHash, attemptIndex = 1 }) => {
  if (!proof || proof.id !== proofId) throw new Error(`PROOF_DEFINITION_MISMATCH:${proofId}`);
  if (attemptIndex !== 1) throw new Error("PROOF_ATTEMPT_INVALID");
  const sourceJob = expectedCiJob(proof); if (!sourceJob) throw new Error(`PROOF_SOURCE_JOB_UNMAPPED:${proofId}`);
  const commands = [];
  for (const command of rawCommands(proof)) {
    const database = command.databaseIndex === undefined ? null : `kernel_${proofId.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${headSha.slice(0, 8)}_${command.databaseIndex}`.slice(0, 63);
    if (database && !commands.some((item) => item.databaseName === database)) commands.push({ executable: "createdb", args: [database], database: null, databaseName: database, phase: "schema" });
    commands.push({ executable: expand(command.file, { baseSha, headSha }), args: command.args.map((value) => expand(value, { baseSha, headSha })), database, databaseName: database, phase: command.phase ?? null });
  }
  const ordered = commands.map((command, commandIndex) => {
    const normalizedArgs = command.args.map((arg) => arg === command.databaseName ? "<generated-database>" : arg), duplicateIdentity = sha256(JSON.stringify({ executable: command.executable, args: normalizedArgs, isolation: proof.kind === "postgres" ? "disposable-postgres-per-proof" : "process", environmentPolicy: proof.kind, phase: command.phase })), semanticCommandIdentity = sha256(JSON.stringify({ duplicateIdentity, proofInputHash }));
    const identity = { proofId, baseSha, headSha, attemptIndex, commandIndex, expectedCiJob: sourceJob, ...command, proofInputHash };
    return { attemptIndex, commandIndex, expectedCiJob: sourceJob, ...command, duplicateIdentity, semanticCommandIdentity, commandIdentity: sha256(JSON.stringify(identity)) };
  });
  const plan = { schemaVersion: 2, proofId, baseSha, headSha, proofInputHash, attemptIndex, expectedCiJob: sourceJob, commands: ordered };
  return { ...plan, commandPlanHash: sha256(JSON.stringify(plan)) };
};

export const validateCommandPlan = ({ plan, proofs = registry().proofs }) => {
  const seen = new Map(), duplicates = [];
  for (const proofId of plan.requiredProofs) {
    const proof = proofs.find((item) => item.id === proofId); if (!proof || !expensiveKinds.has(proof.kind)) continue;
    for (const command of compileRegisteredCommandPlan({ proof, baseSha: plan.baseSha, headSha: plan.headSha }).commands.filter((item) => item.executable !== "createdb")) {
      const previous = seen.get(command.duplicateIdentity);
      if (previous && previous !== proofId) duplicates.push([previous, proofId]); else seen.set(command.duplicateIdentity, proofId);
    }
  }
  if (duplicates.length) throw new Error(`DUPLICATE_EXPENSIVE_COMMAND_PLAN_FORBIDDEN:${duplicates.map((pair) => pair.join("=")).join(",")}`);
  return { status: "PASS", expensiveCommandCount: seen.size, duplicateSemanticCommandCount: 0 };
};
