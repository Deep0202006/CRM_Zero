import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const fail = (message) => { console.error(`knowledge: ${message}`); process.exitCode = 1; };
const unique = (items, label) => { const ids = items.map((item) => item.id); if (new Set(ids).size !== ids.length) fail(`duplicate ${label} id`); };
const pathExists = (path) => existsSync(resolve(root, path));
const tracked = (prefix) => execFileSync("git", prefix ? ["ls-files", prefix] : ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const mapFile = json("docs/engineering/DOMAIN_MAP.json");
const domains = mapFile.domains ?? [];
const authorities = json("docs/engineering/AUTHORITIES.json").facts ?? [];
const capabilities = json("docs/engineering/CAPABILITIES.json").capabilities ?? [];
const lessons = json("docs/engineering/LESSONS.json").lessons ?? [];
const legacy = json("docs/engineering/LEGACY_COVERAGE.json");
if (mapFile.schemaVersion !== 2) fail("DOMAIN_MAP schemaVersion must be 2");
unique(domains, "domain"); unique(authorities, "authority"); unique(capabilities, "capability"); unique(lessons, "lesson");
const authorityIds = new Set(authorities.map((item) => item.id));
const capabilityIds = new Set(capabilities.map((item) => item.id));
const lessonIds = new Set(lessons.map((item) => item.id));
const domainIds = new Set(domains.map((item) => item.id));
const pathFields = ["surfacePaths", "codeRoots", "serverBoundaries", "contractPaths", "criticalTests"];
for (const domain of domains) {
  for (const key of pathFields) for (const path of domain[key] ?? []) if (!pathExists(path)) fail(`${domain.id} missing ${key}: ${path}`);
  for (const id of domain.authorityRefs ?? []) if (!authorityIds.has(id)) fail(`${domain.id} unknown authority: ${id}`);
  for (const id of domain.capabilityRefs ?? []) if (!capabilityIds.has(id)) fail(`${domain.id} unknown capability: ${id}`);
  for (const id of domain.lessonRefs ?? []) if (!lessonIds.has(id)) fail(`${domain.id} unknown lesson: ${id}`);
  for (const id of domain.mustNotWriteAuthorityRefs ?? []) if (!authorityIds.has(id)) fail(`${domain.id} unknown protected authority: ${id}`);
}
for (const capability of capabilities) {
  for (const id of capability.authorityRefs ?? []) if (!authorityIds.has(id)) fail(`${capability.id} unknown authority: ${id}`);
  for (const key of ["implementationPaths", "testPaths"]) for (const path of capability[key] ?? []) if (!pathExists(path)) fail(`${capability.id} missing ${key}: ${path}`);
}
for (const lesson of lessons) {
  for (const domain of lesson.domains ?? []) if (domain !== "all" && !domainIds.has(domain)) fail(`${lesson.id} unknown lesson domain: ${domain}`);
  for (const evidence of lesson.evidence ?? []) if (!evidence.startsWith("public.") && !pathExists(evidence)) fail(`${lesson.id} missing evidence: ${evidence}`);
}
for (const contract of tracked("docs/contracts")) if (!domains.some((domain) => (domain.contractPaths ?? []).includes(contract))) fail(`unmapped contract: ${contract}`);
const covered = (path) => domains.some((domain) => (domain.surfacePaths ?? []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
for (const path of tracked("src/app").filter((path) => /\/(page\.tsx|route\.ts)$/.test(path))) if (!covered(path)) fail(`unmapped surface: ${path}`);
const agents = tracked("").filter((path) => pathExists(path) && /(^|\/)AGENTS\.md$/.test(path));
if (agents.length !== 1 || agents[0] !== "AGENTS.md") fail("exactly one tracked root AGENTS.md required");
if (read("CLAUDE.md").replaceAll("\r\n", "\n") !== "@AGENTS.md\n") fail("CLAUDE.md must be the exact root alias");
for (const path of [".agents", ".claude", ".cursor/rules", ".codex", ".clinerules", ".github/copilot-instructions.md", "GEMINI.md", ".crm-engineering", "tools/crm-graph", "docs/engineering-graph", "docs/os", ".harness", "scripts/harness", "docs/generated", "docs/exec-plans", "docs/field-visits-hardening", "harness.config.json", ".github/workflows/harness.yml"]) if (pathExists(path)) fail(`retired or alternate instruction path exists: ${path}`);
for (const source of legacy.sources ?? []) for (const item of source.items ?? []) {
  const resolution = item.resolution ?? {};
  if (!resolution.type || !resolution.ref) fail(`legacy coverage resolution missing: ${item.legacyId}`);
  if (resolution.type === "lesson" && !lessonIds.has(resolution.ref)) fail(`legacy lesson missing: ${resolution.ref}`);
  if (["contract", "invariant"].includes(resolution.type) && !pathExists(resolution.ref)) fail(`legacy reference missing: ${resolution.ref}`);
}
const meta = json("supabase/migrations/APPLIED_OWNER_MIGRATIONS.json");
const base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const baseMeta = JSON.parse(execFileSync("git", ["show", `${base}:supabase/migrations/APPLIED_OWNER_MIGRATIONS.json`], { cwd: root, encoding: "utf8" }));
for (const [name, value] of [["base", baseMeta], ["head", meta]]) if (!Number.isInteger(value.lastAppliedOwnerMigration) || value.lastAppliedOwnerMigration <= 0 || value.lastAppliedOwnerMigration !== value.immutableThrough) fail(`${name} migration boundary invalid`);
if (meta.lastAppliedOwnerMigration < baseMeta.lastAppliedOwnerMigration || meta.lastAppliedOwnerMigration > baseMeta.lastAppliedOwnerMigration + 1) fail("migration boundary is not monotonic single-step");
const changed = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", "supabase/migrations"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const number = (path) => Number(/^supabase\/migrations\/(\d+)_/.exec(path)?.[1]);
for (const file of changed) if (number(file) <= baseMeta.immutableThrough) fail(`immutable migration changed: ${file}`);
if (meta.lastAppliedOwnerMigration === baseMeta.lastAppliedOwnerMigration + 1 && !changed.some((file) => number(file) === meta.lastAppliedOwnerMigration)) fail("boundary increment lacks additive migration");
if (!process.exitCode) console.log(`Knowledge checks passed (${domains.length} domains, ${lessons.length} lessons).`);
