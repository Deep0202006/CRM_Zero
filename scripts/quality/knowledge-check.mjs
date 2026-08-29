import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isTrackedPathOrDescendant } from "./tracked-paths.mjs";

const root = resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const fail = (message) => {
  console.error(`knowledge: ${message}`);
  process.exitCode = 1;
};
const unique = (items, label) => {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) fail(`duplicate ${label} id`);
};
const pathExists = (path) => existsSync(resolve(root, path));
const tracked = (prefix) =>
  execFileSync("git", prefix ? ["ls-files", prefix] : ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
const mapFile = json("docs/engineering/DOMAIN_MAP.json");
const domains = mapFile.domains ?? [];
const authorities = json("docs/engineering/AUTHORITIES.json").facts ?? [];
const capabilities =
  json("docs/engineering/CAPABILITIES.json").capabilities ?? [];
const lessons = json("docs/engineering/LESSONS.json").lessons ?? [];
const claimFile = json("docs/engineering/CLAIMS.json");
const claims = claimFile.claims ?? [];
const proofFile = json("docs/engineering/PROOFS.json");
const proofs = proofFile.proofs ?? [];
const regressionCases = json("docs/engineering/REGRESSION_CASES.json").cases ?? [];
if (mapFile.schemaVersion !== 2) fail("DOMAIN_MAP schemaVersion must be 2");
if (json("docs/engineering/LESSONS.json").schemaVersion !== 2)
  fail("LESSONS schemaVersion must be 2");
if (proofFile.schemaVersion !== 3) fail("PROOFS schemaVersion must be 3");
if (claimFile.schemaVersion !== 1) fail("CLAIMS schemaVersion must be 1");
unique(domains, "domain");
unique(authorities, "authority");
unique(capabilities, "capability");
unique(lessons, "lesson");
unique(claims, "claim");
unique(proofs, "proof");
const authorityIds = new Set(authorities.map((item) => item.id));
const capabilityIds = new Set(capabilities.map((item) => item.id));
const lessonIds = new Set(lessons.map((item) => item.id));
const domainIds = new Set(domains.map((item) => item.id));
const evalIds = new Set(regressionCases.map((item) => item.id));
const claimIds = new Set(claims.map((item) => item.id));
const pathFields = [
  "surfacePaths",
  "codeRoots",
  "serverBoundaries",
  "contractPaths",
  "criticalTests",
];
for (const domain of domains) {
  for (const key of pathFields)
    for (const path of domain[key] ?? [])
      if (!pathExists(path)) fail(`${domain.id} missing ${key}: ${path}`);
  for (const id of domain.authorityRefs ?? [])
    if (!authorityIds.has(id)) fail(`${domain.id} unknown authority: ${id}`);
  for (const id of domain.capabilityRefs ?? [])
    if (!capabilityIds.has(id)) fail(`${domain.id} unknown capability: ${id}`);
  for (const id of domain.lessonRefs ?? [])
    if (!lessonIds.has(id)) fail(`${domain.id} unknown lesson: ${id}`);
  for (const id of domain.mustNotWriteAuthorityRefs ?? [])
    if (!authorityIds.has(id))
      fail(`${domain.id} unknown protected authority: ${id}`);
}
for (const capability of capabilities) {
  for (const id of capability.authorityRefs ?? [])
    if (!authorityIds.has(id))
      fail(`${capability.id} unknown authority: ${id}`);
  for (const key of ["implementationPaths", "testPaths"])
    for (const path of capability[key] ?? [])
      if (!pathExists(path)) fail(`${capability.id} missing ${key}: ${path}`);
}
for (const capability of capabilities.filter(
  (item) => item.reuse === "required",
)) {
  const users = domains.filter((domain) =>
    (domain.capabilityRefs ?? []).includes(capability.id),
  );
  if (!users.length) fail(`orphan required capability: ${capability.id}`);
  if (
    (capability.implementationPaths ?? []).length &&
    !users.some((domain) =>
      (capability.implementationPaths ?? []).some((path) =>
        [
          ...(domain.surfacePaths ?? []),
          ...(domain.codeRoots ?? []),
          ...(domain.serverBoundaries ?? []),
        ].some(
          (rootPath) =>
            path === rootPath ||
            path.startsWith(`${rootPath}/`) ||
            rootPath.startsWith(`${path}/`),
        ),
      ),
    )
  )
    fail(`capability has no intersecting domain: ${capability.id}`);
}
for (const domain of domains)
  if (
    ["R2", "R3"].includes(domain.riskFloor) &&
    !(domain.lessonRefs ?? []).length
  )
    fail(`high-risk domain has no lessons: ${domain.id}`);
for (const domain of domains)
  for (const test of domain.criticalTests ?? [])
    if (
      [
        "src/lib/__tests__",
        "src/lib/__tests__/receivables",
        "src/lib/__tests__/distributors",
        "src/lib/__tests__/distributorMaster",
      ].includes(test)
    )
      fail(`broad critical-test locator: ${domain.id}`);
for (const lesson of lessons) {
  for (const key of [
    "id",
    "domains",
    "triggers",
    "risk",
    "rule",
    "why",
    "claims",
    "kind",
    "evidence",
    "enforcementRefs",
    "evalRefs",
    "loadByDefault",
  ])
    if (!(key in lesson)) fail(`${lesson.id} missing lesson field: ${key}`);
  if (
    !["mechanical", "judgment"].includes(lesson.kind) ||
    !(lesson.claims ?? []).length
  )
    fail(`${lesson.id} invalid semantic lesson`);
  if (
    lesson.kind === "mechanical" &&
    (!(lesson.enforcementRefs ?? []).length || !(lesson.evalRefs ?? []).length)
  )
    fail(`${lesson.id} mechanical lesson lacks enforcement/eval`);
  for (const claim of lesson.claims ?? [])
    if (!claimIds.has(claim)) fail(`${lesson.id} unknown claim: ${claim}`);
  for (const domain of lesson.domains ?? [])
    if (
      !["all", "engineering-control"].includes(domain) &&
      !domainIds.has(domain)
    )
      fail(`${lesson.id} unknown lesson domain: ${domain}`);
  for (const evidence of lesson.evidence ?? [])
    if (!evidence.startsWith("public.") && !pathExists(evidence))
      fail(`${lesson.id} missing evidence: ${evidence}`);
  for (const enforcement of lesson.enforcementRefs ?? [])
    if (!pathExists(enforcement))
      fail(`${lesson.id} missing enforcement: ${enforcement}`);
  for (const evaluation of lesson.evalRefs ?? [])
    if (!evalIds.has(evaluation))
      fail(`${lesson.id} missing eval: ${evaluation}`);
}
for (const claim of claims) {
  for (const key of [
    "id",
    "statement",
    "severity",
    "domains",
    "positiveMatchers",
    "negativeMatchers",
    "enforcementRefs",
    "evalRefs",
  ])
    if (!(key in claim)) fail(`${claim.id} missing claim field: ${key}`);
  if (!(claim.positiveMatchers ?? []).length)
    fail(`${claim.id} has no independent semantic matcher`);
  for (const domain of claim.domains ?? [])
    if (
      !["all", "engineering-control"].includes(domain) &&
      !domainIds.has(domain)
    )
      fail(`${claim.id} unknown domain: ${domain}`);
  if (
    ["CRITICAL", "HIGH"].includes(claim.severity) &&
    (!(claim.enforcementRefs ?? []).length || !(claim.evalRefs ?? []).length)
  )
    fail(`${claim.id} high-safety claim lacks enforcement/eval`);
  for (const ref of claim.enforcementRefs ?? [])
    if (!pathExists(ref)) fail(`${claim.id} missing enforcement: ${ref}`);
  for (const ref of claim.evalRefs ?? []) {
    if (!evalIds.has(ref)) fail(`${claim.id} missing eval: ${ref}`);
    else if (!(regressionCases.find((item) => item.id === ref)?.proofRefs ?? []).length) fail(`${claim.id} eval lacks executable proof: ${ref}`);
  }
}
const runners = new Set([
    "jest",
    "playwright",
    "bash-postgres",
    "node",
    "owner-sql",
    "fixed-commands",
  ]),
  proofIds = new Set(proofs.map((item) => item.id));
for (const item of regressionCases)
  for (const proof of item.proofRefs ?? [])
    if (!proofIds.has(proof)) fail(`${item.id} unknown executable proof: ${proof}`);
for (const proof of proofs) {
  if (
    !runners.has(proof.runner) ||
    ![
      "unit",
      "build",
      "e2e",
      "postgres",
      "invariant",
      "owner-pre",
      "owner-post",
      "handover",
    ].includes(proof.kind)
  )
    fail(`${proof.id} invalid proof kind/runner`);
  for (const domain of proof.domains ?? [])
    if (domain !== "engineering-control" && !domainIds.has(domain))
      fail(`${proof.id} unknown proof domain: ${domain}`);
  for (const path of proof.paths ?? [])
    if (!pathExists(path)) fail(`${proof.id} missing proof path: ${path}`);
  for (const command of proof.commands ?? []) {
    if (!command.file || !Array.isArray(command.args)) fail(`${proof.id} invalid fixed command`);
    for (const argument of command.args)
      if (/^(?:scripts|src|e2e|docs)\//.test(argument) && !pathExists(argument))
        fail(`${proof.id} missing command path: ${argument}`);
  }
}
for (const domain of domains.filter((item) =>
  ["R2", "R3"].includes(item.riskFloor),
))
  if (
    !proofs.some((proof) => (proof.domains ?? []).includes(domain.id)) &&
    !(
      (domain.requiredProofKinds ?? []).includes("handover") &&
      domain.capabilityRefs?.some(
        (id) =>
          capabilities.find((item) => item.id === id)?.status === "PLANNED",
      )
    )
  )
    fail(`${domain.id} has no meaningful proof`);
for (const domain of domains)
  for (const id of domain.proofRefs ?? [])
    if (!proofIds.has(id)) fail(`${domain.id} unknown proof: ${id}`);
for (const contract of tracked("docs/contracts"))
  if (
    !domains.some((domain) => (domain.contractPaths ?? []).includes(contract))
  )
    fail(`unmapped contract: ${contract}`);
const covered = (path) =>
  domains.some((domain) =>
    (domain.surfacePaths ?? []).some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ),
  );
for (const path of tracked("src/app").filter((path) =>
  /\/(page\.tsx|route\.ts)$/.test(path),
))
  if (!covered(path)) fail(`unmapped surface: ${path}`);
const agents = tracked("").filter(
  (path) => pathExists(path) && /(^|\/)AGENTS\.md$/.test(path),
);
if (agents.length !== 1 || agents[0] !== "AGENTS.md")
  fail("exactly one tracked root AGENTS.md required");
if (read("CLAUDE.md").replaceAll("\r\n", "\n") !== "@AGENTS.md\n")
  fail("CLAUDE.md must be the exact root alias");
const trackedFiles = tracked("");
const retiredHarness = [".", "harness"].join("");
if (
  !isTrackedPathOrDescendant([`${retiredHarness}/foo`], retiredHarness) ||
  isTrackedPathOrDescendant(["docs/engineering/INDEX.md"], retiredHarness)
)
  fail("tracked retired-path helper self-eval failed");
for (const path of [
  ".agents",
  ".claude",
  ".cursor/rules",
  ".clinerules",
  ".github/copilot-instructions.md",
  "GEMINI.md",
  [".crm", "engineering"].join("-"),
  ["tools", "crm", "graph"].join("/"),
  ["docs", "engineering", "graph"].join("-").replace("docs-", "docs/"),
  ["docs", "os"].join("/"),
  retiredHarness,
  ["scripts", "harness"].join("/"),
  "docs/generated",
  ["docs", "exec-plans"].join("/"),
  "docs/field-visits-hardening",
  "harness.config.json",
  ".github/workflows/harness.yml",
])
  if (isTrackedPathOrDescendant(trackedFiles, path))
    fail(`retired or alternate instruction path tracked: ${path}`);
for (const path of trackedFiles.filter((item) => item.startsWith(".codex/")))
  if (!new Set([".codex/config.toml", ".codex/hooks.json", ".codex/rules/zerodata.rules"]).has(path))
    fail(`unsanctioned codex path: ${path}`);
const meta = json("supabase/migrations/APPLIED_OWNER_MIGRATIONS.json");
const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const baseMeta = JSON.parse(
  execFileSync(
    "git",
    ["show", `${base}:supabase/migrations/APPLIED_OWNER_MIGRATIONS.json`],
    { cwd: root, encoding: "utf8" },
  ),
);
for (const [name, value] of [
  ["base", baseMeta],
  ["head", meta],
])
  if (
    !Number.isInteger(value.lastAppliedOwnerMigration) ||
    value.lastAppliedOwnerMigration <= 0 ||
    value.lastAppliedOwnerMigration !== value.immutableThrough
  )
    fail(`${name} migration boundary invalid`);
if (
  meta.lastAppliedOwnerMigration < baseMeta.lastAppliedOwnerMigration ||
  meta.lastAppliedOwnerMigration > baseMeta.lastAppliedOwnerMigration + 1
)
  fail("migration boundary is not monotonic single-step");
const changed = execFileSync(
  "git",
  ["diff", "--name-only", `${base}...HEAD`, "--", "supabase/migrations"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const number = (path) =>
  Number(/^supabase\/migrations\/(\d+)_/.exec(path)?.[1]);
for (const file of changed)
  if (number(file) <= baseMeta.immutableThrough)
    fail(`immutable migration changed: ${file}`);
if (meta.lastAppliedOwnerMigration === baseMeta.lastAppliedOwnerMigration + 1) {
  const certified = meta.lastAppliedOwnerMigration;
  const baseMigrations = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", base, "supabase/migrations"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (!baseMigrations.some((file) => number(file) === certified))
    fail("certification boundary references nonexistent migration");
  if (changed.some((file) => number(file) <= certified))
    fail("certification boundary edited immutable migration");
}
if (!process.exitCode)
  console.log(
    `Knowledge checks passed (${domains.length} domains, ${lessons.length} lessons).`,
  );
