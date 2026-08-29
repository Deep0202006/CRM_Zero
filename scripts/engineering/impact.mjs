import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { dirtyFingerprint, git, parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";
import { extractSourceWrites, extractSqlWrites, resolveWriteAuthorities } from "./authority-resolution.mjs";

const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 };
const maxRisk = (...values) => values.reduce((best, value) => riskRank[value] > riskRank[best] ? value : best, "R0");
const matches = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const sensitiveUnknownPath = (path) => /(?:^|\/)(?:Dockerfile|Makefile|Containerfile|Jenkinsfile)$/i.test(path) || /(?:^|\/)(?:config|configs|configuration|db|database|queries|query|schema|scripts|tools|workflows?|security|auth|rls|infra|infrastructure)(?:\/|$)/i.test(path) || /(?:^|\/)[^/]+\.(?:c?js|mjs|mts|cts|jsx|tsx?|py|rb|php|go|rs|java|sh|bash|zsh|fish|ps1|bat|cmd|ya?ml|toml|json|sql|ini|cfg|conf|properties|prisma|graphql|gql|env)$/i.test(path) || /(?:^|\/)\.env(?:\.|$)/i.test(path);
const controlPath = (path) => /^(?:scripts\/(?:engineering|quality)|docs\/engineering|\.github|\.codex|\.gitignore$|AGENTS\.md$|CLAUDE\.md$|package(?:-lock)?\.json$)/.test(path);
const effectsFor = (path, patch) => {
  const effects = [];
  if (controlPath(path)) effects.push("ENGINEERING_CONTROL", "SECURITY");
  if (/^\.github\//.test(path)) effects.push("WORKFLOW");
  if (/^\.codex\/|(?:^|\/)(?:config|configuration)(?:\/|$)|\.(?:ini|cfg|conf|properties|toml|ya?ml|json)$/i.test(path)) effects.push("CONFIGURATION");
  if (/^supabase\/|(?:^|\/)(?:db|database|schema|queries?)(?:\/|$)|\.(?:sql|prisma|graphql|gql)$/i.test(path)) effects.push("DATABASE");
  if (/^src\/app\/api\//.test(path)) effects.push("API");
  if (/^src\/(?:app|components)\//.test(path)) effects.push("UI");
  if (/auth|rls|policy|service.role|security definer/i.test(`${path}\n${patch}`)) effects.push("AUTHORIZATION", "SECURITY");
  if (/receivable|payment|amount|money/i.test(`${path}\n${patch}`)) effects.push("MONEY");
  if (/migration|schema|create table|alter table/i.test(`${path}\n${patch}`)) effects.push("SCHEMA");
  if (/production|deploy|vercel|dns|cloud/i.test(`${path}\n${patch}`)) effects.push("PRODUCTION");
  return [...new Set(effects)];
};
export const parseNameStatus = (buffer) => {
  const tokens = buffer.toString("utf8").split("\0").filter(Boolean), entries = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (/^[RC]\d+$/.test(status)) entries.push({ status: status[0], score: Number(status.slice(1)), oldPath: tokens[index++], path: tokens[index++] });
    else entries.push({ status: status[0], path: tokens[index++] });
  }
  return entries;
};
const currentDiff = (base, head) => {
  const revision = head === "WORKTREE" ? base : `${base}...${head}`;
  return {
    entries: parseNameStatus(execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", "--find-copies", revision, "--"], { cwd: root })),
    patch: execFileSync("git", ["diff", "--unified=0", revision, "--"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }),
  };
};
const patchSections = (patch, entries) => {
  if (!/^diff --git /m.test(String(patch))) {
    const added = String(patch).split(/\r?\n/).filter((line) => line.startsWith("+")).map((line) => line.slice(1)).join("\n");
    return [{ path: entries[0]?.path ?? "fixture.ts", added: added || String(patch) }];
  }
  const sections = String(patch).split(/^diff --git /m).filter(Boolean).map((section) => {
    const path = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1] ?? entries[0]?.path ?? "fixture.ts";
    const added = section.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
    return { path, added };
  });
  return sections;
};
const registry = (path, head) => head === "WORKTREE" ? readJson(path) : JSON.parse(execFileSync("git", ["show", `${head}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 16 << 20 }));

export const compileImpact = ({ base = "origin/main", head = "WORKTREE", entries, patch, selectedDomains, domainRegistry, authorityRegistry } = {}) => {
  ({ entries, patch } = entries ? { entries, patch: patch ?? "" } : currentDiff(base, head));
  const domains = domainRegistry ?? registry("docs/engineering/DOMAIN_MAP.json", head).domains, facts = authorityRegistry ?? registry("docs/engineering/AUTHORITIES.json", head).facts;
  const mappedDomains = new Set(), effects = new Set(), unresolved = [], pathRecords = [];
  for (const entry of entries) {
    const paths = [entry.oldPath, entry.path].filter(Boolean), matched = new Set(selectedDomains ?? []);
    for (const domain of domains) for (const path of paths) if ([...(domain.surfacePaths ?? []), ...(domain.codeRoots ?? []), ...(domain.serverBoundaries ?? []), ...(domain.contractPaths ?? []), ...(domain.criticalTests ?? []), ...(domain.pathPatterns ?? [])].some((pattern) => matches(path, pattern))) matched.add(domain.id);
    if (paths.some(controlPath)) matched.add("engineering-control");
    const pathEffects = paths.flatMap((path) => effectsFor(path, patch));
    pathEffects.forEach((effect) => effects.add(effect));
    matched.forEach((domain) => mappedDomains.add(domain));
    const unknown = !matched.size && paths.some(sensitiveUnknownPath);
    if (unknown) unresolved.push({ code: "UNMAPPED_PATH", path: entry.path });
    if ((entry.status === "D" || entry.status === "R") && !matched.size) unresolved.push({ code: "STALE_PATH_MAPPING", path: entry.path, oldPath: entry.oldPath });
    const pathRisk = controlPath(entry.path) || pathEffects.some((effect) => ["WORKFLOW", "CONFIGURATION", "ENGINEERING_CONTROL", "AUTHORIZATION", "SECURITY", "DATABASE", "SCHEMA", "MONEY", "PLATFORM", "PRODUCTION"].includes(effect)) || unknown ? "R3" : pathEffects.length ? "R2" : "R0";
    pathRecords.push({ ...entry, domains: [...matched].sort(), effects: [...new Set(pathEffects)].sort(), risk: pathRisk, unknown });
  }
  const domainRisk = [...mappedDomains].map((id) => domains.find((domain) => domain.id === id)?.riskFloor ?? (id === "engineering-control" ? "R3" : "R0"));
  const writeOperations = patchSections(patch, entries).flatMap(({ path, added }) => [...extractSourceWrites(path, added), ...extractSqlWrites(path, added)]), authority = resolveWriteAuthorities(writeOperations, facts);
  unresolved.push(...authority.unresolved);
  for (const resolution of authority.resolutions) {
    const pathDomains = selectedDomains ?? pathRecords.find((record) => record.path === resolution.sourcePath || record.oldPath === resolution.sourcePath)?.domains ?? [];
    const relevant = pathDomains.map((id) => domains.find((domain) => domain.id === id)).filter(Boolean);
    if (!relevant.some((domain) => (domain.authorityRefs ?? []).includes(resolution.authority) && !(domain.mustNotWriteAuthorityRefs ?? []).includes(resolution.authority))) unresolved.push({ code: "PROHIBITED_WRITE_AUTHORITY", target: resolution.target, authority: resolution.authority, sourcePath: resolution.sourcePath, relevantDomains: relevant.map((domain) => domain.id).sort() });
  }
  for (const entry of entries) {
    const migration = /^supabase\/migrations\/(\d+)_/.exec(entry.path);
    if (migration && Number(migration[1]) <= 51) unresolved.push({ code: "IMMUTABLE_MIGRATION", path: entry.path });
  }
  const result = {
    schemaVersion: 2,
    baseSha: git("rev-parse", base),
    headSha: head === "WORKTREE" ? git("rev-parse", "HEAD") : git("rev-parse", head),
    treeSha: head === "WORKTREE" ? git("rev-parse", "HEAD^{tree}") : git("rev-parse", `${head}^{tree}`),
    dirtyFingerprint: dirtyFingerprint(),
    changes: pathRecords,
    changedPaths: [...new Set(entries.flatMap((entry) => [entry.oldPath, entry.path].filter(Boolean)))],
    domains: [...mappedDomains].sort(), effects: [...effects].sort(), changedAuthorities: [...new Set(authority.resolutions.map((item) => item.authority))].sort(),
    writeOperations, writeResolutions: authority.resolutions,
    risk: maxRisk(...domainRisk, ...pathRecords.map((entry) => entry.risk), writeOperations.length || unresolved.some((item) => item.code.includes("AUTHORITY")) ? "R3" : "R0"),
    unresolved,
    writable: unresolved.length === 0,
    impactHash: sha256(JSON.stringify({ entries, patch })),
  };
  return result;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { value } = parseArgs(), result = compileImpact({ base: value("--base", "origin/main"), head: value("--head", "WORKTREE") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.writable) process.exitCode = 2;
}
