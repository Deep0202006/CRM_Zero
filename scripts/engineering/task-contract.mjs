import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../.."), args = process.argv.slice(2);
const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const base = value("--base") ?? process.env.BASE_SHA ?? "origin/main", head = value("--head") ?? process.env.HEAD_SHA ?? "HEAD";
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dir = resolve(root, "docs/engineering/tasks");
const paths = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => `docs/engineering/tasks/${name}`) : [];
const fail = (code) => { console.error(code); process.exit(2); };
const canonical = (contract) => { const { taskHash, ...rest } = contract; return rest; };
const required = (contract) => ["schemaVersion", "taskId", "taskHash", "baseSha", "risk", "domains", "requiredClaims", "criteria"].every((key) => key in contract);
const active = paths.map((path) => ({ path, value: JSON.parse(readFileSync(resolve(root, path), "utf8")) })).filter(({ value }) => value.status !== "completed");
const needsContract = () => {
  const impact = JSON.parse(execFileSync("node", ["scripts/engineering/impact.mjs", "--base", base, "--head", head], { cwd: root, encoding: "utf8" }));
  return impact.risk === "R3" || impact.domains.includes("engineering-control") || impact.domains.includes("platform-handover") || impact.effects.some((x) => ["AUTHORIZATION", "SECURITY"].includes(x));
};
if (args.includes("--check") && !needsContract()) { console.log(JSON.stringify({ status: "NOT_REQUIRED" })); process.exit(0); }
if (active.length !== 1) fail("TASK_CONTRACT_REQUIRED");
const { path, value: contract } = active[0];
if (!required(contract) || contract.taskHash !== hash(canonical(contract)) || !["R0", "R1", "R2", "R3"].includes(contract.risk) || !Array.isArray(contract.domains) || !Array.isArray(contract.requiredClaims) || !Array.isArray(contract.criteria)) fail("TASK_CONTRACT_INVALID");
const ids = new Set();
for (const criterion of contract.criteria) {
  if (!criterion.id || ids.has(criterion.id) || typeof criterion.description !== "string" || !Array.isArray(criterion.proofRefs) || !Array.isArray(criterion.evalRefs) || !(criterion.proofRefs.length || criterion.evalRefs.length || criterion.ownerGate)) fail("TASK_CRITERION_UNPROVABLE");
  if ("status" in criterion || "pass" in criterion || "result" in criterion) fail("TASK_CONTRACT_MANUAL_RESULT");
  ids.add(criterion.id);
}
if (args.includes("--check")) {
  const commits = git("log", "--reverse", "--format=%H", `${base}..${head}`, "--", path).split(/\r?\n/).filter(Boolean);
  if (commits.length) {
    const first = JSON.parse(git("show", `${commits[0]}:${path}`));
    const removed = (before, after) => before.some((x) => !after.includes(x));
    const beforeCriteria = new Map(first.criteria.map((x) => [x.id, x]));
    if (first.taskHash !== contract.taskHash || first.baseSha !== contract.baseSha || ["R0", "R1", "R2", "R3"].indexOf(contract.risk) < ["R0", "R1", "R2", "R3"].indexOf(first.risk) || removed(first.domains, contract.domains) || removed(first.requiredClaims, contract.requiredClaims) || [...beforeCriteria].some(([id, criterion]) => !ids.has(id) || removed(criterion.proofRefs, contract.criteria.find((x) => x.id === id).proofRefs) || removed(criterion.evalRefs, contract.criteria.find((x) => x.id === id).evalRefs))) fail("TASK_CONTRACT_WEAKENED");
  }
}
const result = { status: "PASS", path, taskId: contract.taskId, taskHash: contract.taskHash, baseSha: contract.baseSha, criteria: contract.criteria.map((x) => x.id) };
if (args.includes("--acceptance") || process.env.ZEROGRAPH_TASK_ACCEPTANCE_FIXTURE) {
  const fixture = process.env.ZEROGRAPH_TASK_ACCEPTANCE_FIXTURE ? JSON.parse(process.env.ZEROGRAPH_TASK_ACCEPTANCE_FIXTURE) : null;
  const knownProofs = new Set(JSON.parse(readFileSync(resolve(root, "docs/engineering/PROOFS.json"), "utf8")).proofs.map((x) => x.id));
  const incomplete = contract.criteria.find((criterion) => fixture ? fixture[criterion.id] !== "PASS" : criterion.proofRefs.some((ref) => !knownProofs.has(ref)) || criterion.evalRefs.some((ref) => !existsSync(resolve(root, ref))));
  console.log(JSON.stringify({ ...result, TASK_ACCEPTANCE_COMPLETE: !incomplete, incompleteCriterion: incomplete?.id ?? null }));
  if (incomplete) process.exit(1);
  process.exit(0);
}
console.log(JSON.stringify(result));
