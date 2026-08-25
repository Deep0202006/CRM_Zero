import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  json = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8")),
  cases = json("docs/engineering/ENGINEERING_GOLDEN_CASES.json").cases,
  claims = json("docs/engineering/CLAIMS.json").claims,
  domains = json("docs/engineering/DOMAIN_MAP.json").domains,
  proofs = json("docs/engineering/PROOFS.json").proofs,
  rank = { R0: 0, R1: 1, R2: 2, R3: 3 },
  claimIds = new Set(claims.map((x) => x.id)),
  coveredClaims = new Set(cases.flatMap((x) => x.requiredClaims ?? [])),
  failures = [];
for (const claim of claimIds)
  if (!coveredClaims.has(claim)) failures.push(`CLAIM_UNEXERCISED:${claim}`);
const executableKinds = new Set(["resolve", "blocker", "control", "semantic"]),
  criticalCovered = new Set(
    cases
      .filter((x) => executableKinds.has(x.kind))
      .flatMap((x) => x.requiredClaims ?? []),
  );
for (const claim of claims.filter((x) => x.severity === "CRITICAL"))
  if (!criticalCovered.has(claim.id))
    failures.push(`CRITICAL_CLAIM_NOT_EXECUTABLE:${claim.id}`);
const resolvedDomains = new Set(
  cases
    .filter((x) => x.kind === "resolve")
    .flatMap((x) => x.expectedDomains ?? []),
);
for (const domain of domains.filter((x) => ["R2", "R3"].includes(x.riskFloor)))
  if (!resolvedDomains.has(domain.id))
    failures.push(`DOMAIN_RESOLVE_CASE_MISSING:${domain.id}`);
const metrics = [];
for (const test of cases) {
  for (const claim of test.requiredClaims ?? [])
    if (!claimIds.has(claim))
      failures.push(`${test.id}:UNKNOWN_CLAIM:${claim}`);
  if (!["resolve", "blocker"].includes(test.kind)) continue;
  const run = spawnSync(
    "node",
    ["scripts/engineering/context.mjs", "--task", test.inputTask],
    { cwd: root, encoding: "utf8" },
  );
  if (run.status !== 0) {
    failures.push(`${test.id}:CONTEXT_AMBIGUOUS`);
    continue;
  }
  let pack;
  try {
    pack = JSON.parse(run.stdout);
  } catch {
    failures.push(`${test.id}:INVALID_JSON`);
    continue;
  }
  metrics.push(pack.estimatedTokens ?? 0);
  for (const domain of test.expectedDomains ?? [])
    if (!pack.domains.includes(domain))
      failures.push(`${test.id}:DOMAIN:${domain}`);
  for (const authority of test.requiredAuthorities ?? [])
    if (!pack.authorities.some((x) => x.id === authority))
      failures.push(`${test.id}:AUTHORITY:${authority}`);
  for (const authority of test.forbiddenAuthorities ?? [])
    if (!pack.mustNotWriteAuthorities.includes(authority))
      failures.push(`${test.id}:FORBIDDEN:${authority}`);
  if (test.minimumRisk && rank[pack.risk] < rank[test.minimumRisk])
    failures.push(`${test.id}:RISK`);
  for (const claim of test.expectedResolvedClaims ?? [])
    if (!pack.criticalClaims?.includes(claim))
      failures.push(`${test.id}:CLAIM:${claim}`);
  if (pack.estimatedTokens > 900) failures.push(`${test.id}:TOKEN_BUDGET`);
  if (
    !(test.candidatePathsAnyOf ?? []).every((path) =>
      pack.candidatePaths.some(
        (candidate) => candidate === path || candidate.startsWith(path),
      ),
    )
  )
    failures.push(`${test.id}:PATH`);
  for (const effect of test.expectedEffects ?? [])
    if (
      ![...(pack.effects ?? []), ...(pack.relevantEffects ?? [])].includes(
        effect,
      )
    )
      failures.push(`${test.id}:EFFECT:${effect}`);
  if (
    test.expectedBlocker !== undefined &&
    pack.blocker !== test.expectedBlocker
  )
    failures.push(`${test.id}:BLOCKER:${pack.blocker ?? "NONE"}`);
  const kinds = new Set(
    proofs
      .filter((p) => pack.requiredProofRefs.includes(p.id))
      .map((p) => p.kind),
  );
  for (const kind of test.requiredProofKinds ?? [])
    if (!kinds.has(kind)) failures.push(`${test.id}:PROOF:${kind}`);
}
metrics.sort((a, b) => a - b);
const percentile = (p) =>
    metrics[Math.min(metrics.length - 1, Math.ceil(metrics.length * p) - 1)] ??
    0,
  failedCases = new Set(failures.map((x) => x.split(":")[0])),
  output = {
    total: cases.length,
    executable: cases.filter((x) => executableKinds.has(x.kind)).length,
    pass: cases.length - failedCases.size,
    fail: failures.length,
    failures,
    tokenMetrics: {
      median: percentile(0.5),
      p90: percentile(0.9),
      max: Math.max(0, ...metrics),
    },
  };
console.log(JSON.stringify(output));
if (failures.length) process.exit(1);
