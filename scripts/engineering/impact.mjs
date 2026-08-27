import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { dirtyFingerprint, git, parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";

const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 };
const maxRisk = (...values) => values.reduce((best, value) => riskRank[value] > riskRank[best] ? value : best, "R0");
const matches = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const executable = (path) => /(?:^|\/)(?:package\.json|[^/]+\.(?:c?js|mjs|mts|cts|jsx|tsx?|py|sh|bash|ps1|ya?ml|toml|json|sql))$/i.test(path);
const controlPath = (path) => /^(?:scripts\/(?:engineering|quality)|docs\/engineering|\.github|\.codex|\.gitignore$|AGENTS\.md$|CLAUDE\.md$|package(?:-lock)?\.json$)/.test(path);
const effectsFor = (path, patch) => {
  const effects = [];
  if (controlPath(path)) effects.push("ENGINEERING_CONTROL", "SECURITY");
  if (/^\.github\//.test(path)) effects.push("WORKFLOW");
  if (/^\.codex\//.test(path)) effects.push("CONFIGURATION");
  if (/^supabase\/migrations\/\d+_.*\.sql$/.test(path)) effects.push("DATABASE");
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
const authorityTokens = (facts) => facts.flatMap((fact) => [fact.id, fact.authority, ...(fact.identity ?? []), ...(fact.owns ?? [])].filter(Boolean).map((value) => String(value).toLowerCase()));
export const compileImpact = ({ base = "origin/main", head = "WORKTREE", entries, patch } = {}) => {
  ({ entries, patch } = entries ? { entries, patch: patch ?? "" } : currentDiff(base, head));
  const domains = readJson("docs/engineering/DOMAIN_MAP.json").domains, facts = readJson("docs/engineering/AUTHORITIES.json").facts;
  const mappedDomains = new Set(), effects = new Set(), unresolved = [], pathRecords = [];
  for (const entry of entries) {
    const paths = [entry.oldPath, entry.path].filter(Boolean), matched = new Set();
    for (const domain of domains) for (const path of paths) if ([...(domain.surfacePaths ?? []), ...(domain.codeRoots ?? []), ...(domain.serverBoundaries ?? []), ...(domain.contractPaths ?? []), ...(domain.criticalTests ?? []), ...(domain.pathPatterns ?? [])].some((pattern) => matches(path, pattern))) matched.add(domain.id);
    if (paths.some(controlPath)) matched.add("engineering-control");
    const pathEffects = paths.flatMap((path) => effectsFor(path, patch));
    pathEffects.forEach((effect) => effects.add(effect));
    matched.forEach((domain) => mappedDomains.add(domain));
    const unknown = !matched.size && paths.some(executable);
    if (unknown) unresolved.push({ code: "UNMAPPED_PATH", path: entry.path });
    if ((entry.status === "D" || entry.status === "R") && !matched.size) unresolved.push({ code: "STALE_PATH_MAPPING", path: entry.path, oldPath: entry.oldPath });
    const pathRisk = controlPath(entry.path) || pathEffects.some((effect) => ["WORKFLOW", "CONFIGURATION", "ENGINEERING_CONTROL", "AUTHORIZATION", "SECURITY", "DATABASE", "SCHEMA", "MONEY", "PLATFORM", "PRODUCTION"].includes(effect)) || unknown ? "R3" : pathEffects.length ? "R2" : "R0";
    pathRecords.push({ ...entry, domains: [...matched].sort(), effects: [...new Set(pathEffects)].sort(), risk: pathRisk, unknown });
  }
  const domainRisk = [...mappedDomains].map((id) => domains.find((domain) => domain.id === id)?.riskFloor ?? (id === "engineering-control" ? "R3" : "R0"));
  const writeTargets = [...patch.matchAll(/^\+.*?\.from\(["']([^"']+)["']\)[\s\S]{0,240}?\.(?:insert|upsert|update|delete)\s*\(/gim)].map((match) => match[1]);
  const rpcTargets = [...patch.matchAll(/^\+.*?\.rpc\(["']([^"']+)["']/gim)].map((match) => match[1]);
  const tokens = authorityTokens(facts), unknownWrites = [...writeTargets, ...rpcTargets].filter((target) => !tokens.some((token) => token.includes(target.toLowerCase())));
  for (const target of unknownWrites) unresolved.push({ code: "AUTHORITY_UNRESOLVED", target });
  const protectedIds = new Set([...mappedDomains].flatMap((id) => domains.find((domain) => domain.id === id)?.mustNotWriteAuthorityRefs ?? []));
  for (const target of [...writeTargets, ...rpcTargets]) for (const fact of facts.filter((item) => protectedIds.has(item.id)))
    if (authorityTokens([fact]).some((token) => token.includes(target.toLowerCase()) || target.toLowerCase().includes(token))) unresolved.push({ code: "PROHIBITED_WRITE_AUTHORITY", target, authority: fact.id });
  for (const entry of entries) {
    const migration = /^supabase\/migrations\/(\d+)_/.exec(entry.path);
    if (migration && Number(migration[1]) <= 51) unresolved.push({ code: "IMMUTABLE_MIGRATION", path: entry.path });
  }
  const result = {
    schemaVersion: 1,
    baseSha: git("rev-parse", base),
    headSha: head === "WORKTREE" ? git("rev-parse", "HEAD") : git("rev-parse", head),
    treeSha: head === "WORKTREE" ? git("rev-parse", "HEAD^{tree}") : git("rev-parse", `${head}^{tree}`),
    dirtyFingerprint: dirtyFingerprint(),
    changes: pathRecords,
    changedPaths: [...new Set(entries.flatMap((entry) => [entry.oldPath, entry.path].filter(Boolean)))],
    domains: [...mappedDomains].sort(), effects: [...effects].sort(),
    changedAuthorities: [...new Set([...writeTargets, ...rpcTargets])],
    risk: maxRisk(...domainRisk, ...pathRecords.map((entry) => entry.risk)),
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
