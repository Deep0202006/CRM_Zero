import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compileProofPlan } from "./proof-plan.mjs";
import { dirtyFingerprint, environmentPolicyHash, parseArgs, readJson, root, run, safeEnvironment, sha256 } from "./kernel-lib.mjs";

const commandFor = (proof) => {
  if (proof.commands) return proof.commands;
  if (proof.runner === "node") return proof.paths.map((path) => ({ file: process.execPath, args: [path] }));
  if (proof.runner === "jest") return [{ file: "npx", args: ["jest", "--runInBand", ...proof.paths] }];
  if (proof.runner === "playwright") return [{ file: "npx", args: ["playwright", "test", ...proof.paths, "--retries=0", "--trace=on-first-retry"] }];
  if (proof.runner === "bash-postgres") {
    if (process.env.CI !== "true") throw new Error("LOCAL_POSTGRES_PROOF_PROHIBITED");
    return proof.paths.map((path, index) => ({ file: "bash", args: [path], database: `kernel_${proof.id.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${index}` }));
  }
  if (proof.runner === "owner-sql") throw new Error(`HUMAN_APPROVAL_REQUIRED:${proof.id}`);
  throw new Error(`PROOF_RUNNER_UNSUPPORTED:${proof.id}`);
};
const expand = (value, identity) => String(value).replaceAll("$BASE_SHA", identity.baseSha).replaceAll("$HEAD_SHA", identity.headSha);
const execute = (commands, identity, attempt = 1) => {
  const results = [];
  for (const command of commands) {
    const file = expand(command.file, identity), args = command.args.map((value) => expand(value, identity));
    const database = command.database ? `${command.database}_a${attempt}` : undefined;
    const baseEnvironment = safeEnvironment({ ...process.env, CI: process.env.CI ?? "false" });
    const environment = { ...baseEnvironment, ...(database ? { PGDATABASE: database, CRM_MASTER_DB_DISPOSABLE: "1" } : {}) };
    if (command.database) {
      const created = run("createdb", [database], { env: baseEnvironment });
      results.push({ commandIdentity: sha256(JSON.stringify({ file: "createdb", args: [database] })), exitCode: created.status ?? 1, stdoutHash: sha256(created.stdout ?? ""), stderrHash: sha256(created.stderr ?? String(created.error ?? "")) });
      if (created.status !== 0) return { passed: false, results };
    }
    const result = run(file, args, { env: environment });
    results.push({ commandIdentity: sha256(JSON.stringify({ file, args })), exitCode: result.status ?? 1, stdoutHash: sha256(result.stdout ?? ""), stderrHash: sha256(result.stderr ?? String(result.error ?? "")) });
    if (result.status !== 0) return { passed: false, results };
  }
  return { passed: true, results };
};
export const runRegisteredProof = ({ proofId, base = "origin/main", head = "WORKTREE", output, plan } = {}) => {
  plan ??= compileProofPlan({ base, head });
  const proof = readJson("docs/engineering/PROOFS.json").proofs.find((item) => item.id === proofId);
  if (!proof) throw new Error(`PROOF_UNMAPPED:${proofId}`);
  if (!plan.requiredProofs.includes(proofId)) throw new Error(`PROOF_NOT_REQUIRED:${proofId}`);
  const startedAt = new Date().toISOString(), commands = commandFor(proof);
  const first = execute(commands, plan, 1), retry = first.passed ? null : execute(commands, plan, 2);
  const status = first.passed ? "PASS" : retry?.passed ? "FLAKY_DETECTED" : "FAIL";
  const evidence = {
    schemaVersion: 1, proofId, kind: proof.kind, status, startedAt, endedAt: new Date().toISOString(),
    headSha: plan.headSha, treeSha: plan.treeSha, baseSha: plan.baseSha,
    dirtyFingerprint: dirtyFingerprint(), impactHash: plan.impactHash, planHash: plan.planHash,
    runnerIdentity: sha256(readFileSync(resolve(root, "scripts/engineering/proof-runner.mjs"))), environmentPolicyHash: environmentPolicyHash(), proofDefinitionHash: sha256(JSON.stringify(proof)),
    attempts: [first, retry].filter(Boolean).map((attempt) => attempt.results),
  };
  const path = resolve(root, output ?? `artifacts/engineering-evidence/${proofId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const allowed = new Set(["--base", "--head", "--proof", "--kind", "--output"]);
  for (let index = 2; index < process.argv.length; index += 2) if (!allowed.has(process.argv[index])) { console.error(`UNKNOWN_ARGUMENT:${process.argv[index]}`); process.exit(2); }
  const { value } = parseArgs(), base = value("--base", "origin/main"), head = value("--head", "WORKTREE"), proofId = value("--proof"), kind = value("--kind"), output = value("--output");
  try {
    const plan = compileProofPlan({ base, head });
    const selected = proofId ? [proofId] : kind ? plan.requiredByKind[kind] : [];
    if (!selected?.length) {
      if (kind && plan.notRequiredKinds.includes(kind)) { console.log(JSON.stringify({ kind, status: "NOT_REQUIRED", planHash: plan.planHash })); process.exit(0); }
      throw new Error("PROOF_UNMAPPED");
    }
    const results = selected.map((id) => runRegisteredProof({ proofId: id, base, head, output: selected.length === 1 ? output : undefined, plan }));
    console.log(JSON.stringify(results, null, 2));
    if (results.some((result) => result.status !== "PASS")) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
