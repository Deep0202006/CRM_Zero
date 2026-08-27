import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveContext } from "./context.mjs";
import { buildSourceIndex } from "./source-index.mjs";
import { readJson, root } from "./kernel-lib.mjs";
const cases = readJson("docs/engineering/REGRESSION_CASES.json").cases;
const claims = readJson("docs/engineering/CLAIMS.json").claims;
const proofIds = new Set(readJson("docs/engineering/PROOFS.json").proofs.map((item) => item.id));
const rank = { R0: 0, R1: 1, R2: 2, R3: 3 }, failures = [], exercised = new Set(cases.flatMap((item) => item.requiredClaims ?? [])), index = buildSourceIndex({ writeCache: false });
for (const claim of claims) {
  if (!exercised.has(claim.id)) failures.push(`CLAIM_UNEXERCISED:${claim.id}`);
  if (["HIGH", "CRITICAL"].includes(claim.severity)) {
    if (!(claim.enforcementRefs ?? []).some((path) => existsSync(resolve(root, path)))) failures.push(`CLAIM_ENFORCEMENT_MISSING:${claim.id}`);
    if (!(claim.evalRefs ?? []).some((id) => cases.some((item) => item.id === id))) failures.push(`CLAIM_REGRESSION_MISSING:${claim.id}`);
  }
}
for (const item of cases.filter((candidate) => candidate.kind === "resolve")) {
  const pack = resolveContext({ task: item.inputTask, index });
  const expectedStatus = item.expectedStatus ?? "RESOLVED";
  if (pack.status !== expectedStatus) failures.push(`${item.id}:${pack.status}`);
  if (expectedStatus !== "RESOLVED" && pack.requiredOpenPaths.length) failures.push(`${item.id}:AMBIGUOUS_WRITE_SCOPE`);
  for (const domain of item.expectedDomains ?? []) if (!pack.domains.includes(domain)) failures.push(`${item.id}:DOMAIN:${domain}`);
  if (item.minimumRisk && rank[pack.risk] < rank[item.minimumRisk]) failures.push(`${item.id}:RISK`);
  if (expectedStatus === "RESOLVED") for (const path of item.candidatePathsAnyOf ?? []) if (!pack.candidatePaths.some((candidate) => candidate.path === path || candidate.path.startsWith(`${path}/`))) failures.push(`${item.id}:PATH:${path}`);
}
for (const item of cases) if (!(item.proofRefs ?? []).length || item.proofRefs.some((id) => !proofIds.has(id))) failures.push(`${item.id}:EXECUTABLE_PROOF_REF`);
console.log(JSON.stringify({ cases: cases.length, claims: claims.length, failures }, null, 2));
if (failures.length) process.exit(1);
