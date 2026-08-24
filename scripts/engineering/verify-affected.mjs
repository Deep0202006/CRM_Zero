import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2), has = (flag) => args.includes(flag), value = (flag) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const kind = value("--kind") ?? "all", execute = has("--execute"), base = value("--base") ?? "origin/main", head = value("--head") ?? "HEAD", output = value("--evidence");
const run = (bin, argv, options = {}) => spawnSync(process.platform === "win32" && ["npx","npm"].includes(bin) ? `${bin}.cmd` : bin, argv, { cwd: root, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit", env: options.env ?? process.env });
const planRun = run("node", ["scripts/engineering/proof-plan.mjs", "--base", base, "--head", head], { capture: true });
if (planRun.status !== 0) { process.stderr.write(planRun.stderr || planRun.stdout); process.exit(planRun.status || 1); }
const plan = JSON.parse(planRun.stdout), selected = [];
if (["all", "unit"].includes(kind)) selected.push(...plan.unitProofs);
if (["all", "postgres"].includes(kind)) selected.push(...plan.postgresProofs);
if (["all", "e2e"].includes(kind)) selected.push(...plan.e2eProofs);
const results = [];
const record = (proof, status, details = "") => results.push({ proofId: proof.id, kind: proof.kind, status, detailsHash: createHash("sha256").update(details).digest("hex") });
if(execute&&!selected.length&&["postgres","e2e"].includes(kind)){const code=kind==="postgres"?"NO_POSTGRES_PROOF_REQUIRED":"NO_E2E_PROOF_REQUIRED";record({id:code,kind},"PASS",code);console.log(code);}
if (execute && ["all", "unit"].includes(kind)) {
  const changedSource=plan.changedPaths.filter(path=>path.startsWith("src/")&&/\.(?:ts|tsx|js|jsx)$/.test(path));
  if(changedSource.length){const related=run("npx",["jest","--runInBand","--findRelatedTests",...changedSource]);record({id:"related-jest",kind:"unit"},related.status===0?"PASS":"FAIL",String(related.status));if(related.status!==0)process.exit(1);}
}
if (execute) for (const proof of selected) {
  let result;
  if (proof.runner === "jest") result = run("npx", ["jest", "--runInBand", ...proof.paths]);
  else if (proof.runner === "node") for (const path of proof.paths) { result = run("node", [path]); if (result.status !== 0) break; }
  else if (proof.runner === "playwright") result = run("npx", ["playwright", "test", ...proof.paths, "--retries=1"]);
  else if (proof.runner === "bash-postgres") {
    if (process.env.CI !== "true") { console.error("LOCAL_POSTGRES_PROOF_PROHIBITED"); process.exit(2); }
    for (const [index,path] of proof.paths.entries()) { const database=`zg_${proof.id.replace(/[^a-z0-9]/gi,"_").toLowerCase()}_${index}`;result=run("createdb",[database]);if(result.status===0)result=run("bash",[path],{env:{...process.env,PGDATABASE:database}});if(result.status!==0)break; }
  }
  if (!result || result.status !== 0) { record(proof, "FAIL", `${result?.status ?? "NO_RUN"}`); break; }
  record(proof, "PASS", proof.id);
} else for (const proof of selected) record(proof, "PLANNED", proof.id);
const git = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
const evidence = { schemaVersion: 1, headSha: plan.headSha, treeSha: plan.treeSha, planHash: plan.planHash, kind, execute, results };
const evidencePath = output ?? git("rev-parse", "--git-path", `zerograph/sessions/evidence-${kind}.json`);
mkdirSync(dirname(resolve(root, evidencePath)), { recursive: true }); writeFileSync(resolve(root, evidencePath), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
if (results.some((item) => item.status === "FAIL")) process.exit(1);
