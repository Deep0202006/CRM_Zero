import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dirtyFingerprint, git, parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";
import { buildSqlFunctionCatalogue, deriveFunctionAuthorities, extractSourceOperations, extractSqlOperations, resolveWriteAuthorities } from "./authority-resolution.mjs";

const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 };
const maxRisk = (...values) => values.reduce((best, value) => riskRank[value] > riskRank[best] ? value : best, "R0");
const matches = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const domainPaths = (domain) => [...(domain.surfacePaths ?? []), ...(domain.codeRoots ?? []), ...(domain.serverBoundaries ?? []), ...(domain.contractPaths ?? []), ...(domain.criticalTests ?? []), ...(domain.pathPatterns ?? [])];
const sensitiveUnknownPath = (path) => /(?:^|\/)(?:Dockerfile|Makefile|Containerfile|Jenkinsfile)$/i.test(path) || /(?:^|\/)(?:config|configs|configuration|db|database|queries|query|schema|scripts|tools|workflows?|security|auth|rls|infra|infrastructure)(?:\/|$)/i.test(path) || /(?:^|\/)[^/]+\.(?:c?js|mjs|mts|cts|jsx|tsx?|py|rb|php|go|rs|java|sh|bash|zsh|fish|ps1|bat|cmd|ya?ml|toml|json|sql|ini|cfg|conf|properties|prisma|graphql|gql|env)$/i.test(path) || /(?:^|\/)\.env(?:\.|$)/i.test(path);
const controlPath = (path) => /^(?:scripts\/(?:engineering|quality)|docs\/engineering|\.github|\.codex|\.gitignore$|AGENTS\.md$|CLAUDE\.md$|package(?:-lock)?\.json$)/.test(path);
const effectsFor = (path, text) => {
  const effects = [];
  if (controlPath(path)) effects.push("ENGINEERING_CONTROL", "SECURITY");
  if (/^\.github\//.test(path)) effects.push("WORKFLOW");
  if (/^\.codex\/|(?:^|\/)(?:config|configuration)(?:\/|$)|\.(?:ini|cfg|conf|properties|toml|ya?ml|json)$/i.test(path)) effects.push("CONFIGURATION");
  if (/^supabase\/|(?:^|\/)(?:db|database|schema|queries?)(?:\/|$)|\.(?:sql|prisma|graphql|gql)$/i.test(path)) effects.push("DATABASE");
  if (/^src\/app\/api\//.test(path)) effects.push("API");
  if (/^src\/(?:app|components)\//.test(path)) effects.push("UI");
  if (/auth|rls|policy|service.role|security definer/i.test(`${path}\n${text}`)) effects.push("AUTHORIZATION", "SECURITY");
  if (/receivable|payment|amount|money/i.test(`${path}\n${text}`)) effects.push("MONEY");
  if (/migration|schema|create table|alter table/i.test(`${path}\n${text}`)) effects.push("SCHEMA");
  if (/production|deploy|vercel|dns|cloud/i.test(`${path}\n${text}`)) effects.push("PRODUCTION");
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
  return { entries: parseNameStatus(execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", "--find-copies", revision, "--"], { cwd: root })), patch: execFileSync("git", ["diff", "--binary", revision, "--"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }) };
};
const registry = (path, revision) => revision === "WORKTREE" ? readJson(path) : JSON.parse(execFileSync("git", ["show", `${revision}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 16 << 20 }));
const show = (revision, path) => {
  if (!path) return "";
  if (revision === "WORKTREE") { const absolute = resolve(root, path); return existsSync(absolute) ? readFileSync(absolute, "utf8") : ""; }
  const result = execFileSync("git", ["show", `${revision}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  return result;
};
const safeShow = (revision, path) => { try { return show(revision, path); } catch { return ""; } };
const trackedSql = (revision) => {
  const paths = (revision === "WORKTREE" ? execFileSync("git", ["ls-files", "-z"], { cwd: root }) : execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", revision], { cwd: root })).toString("utf8").split("\0").filter((path) => path.endsWith(".sql"));
  return paths.map((path) => ({ path, text: safeShow(revision, path) })).filter((file) => file.text).map((file) => ({ ...file, contentHash: sha256(file.text) }));
};
const parseOperations = (path, text, catalogue) => {
  const contentHash = sha256(text);
  let records = [...extractSourceOperations(path, text, { contentHash }), ...extractSqlOperations(path, text, { contentHash, catalogue })];
  records = records.map((item) => {
    if (item.operationKind !== "rpc") return item;
    const effect = catalogue.get(item.functionName)?.effect ?? "UNKNOWN";
    return { ...item, effect, analysisError: effect === "UNKNOWN" ? "RPC_EFFECT_UNKNOWN" : undefined, operationIdentity: sha256(JSON.stringify([item.operationIdentity, effect])) };
  });
  return records;
};
const multisetDifference = (left, right) => {
  const counts = new Map(); for (const item of right) counts.set(item.operationIdentity, (counts.get(item.operationIdentity) ?? 0) + 1);
  return left.filter((item) => { const count = counts.get(item.operationIdentity) ?? 0; if (!count) return true; counts.set(item.operationIdentity, count - 1); return false; });
};
const versionsFor = (entry, base, head, fileVersions, patch) => {
  if (fileVersions?.[entry.path] || fileVersions?.[entry.oldPath]) return fileVersions[entry.path] ?? fileVersions[entry.oldPath];
  if (patch !== undefined && !/^diff --git /m.test(String(patch)) && base === "origin/main" && head === "WORKTREE") return { base: "", head: String(patch).split(/\r?\n/).map((line) => line.startsWith("+") ? line.slice(1) : line).join("\n") };
  return { base: entry.status === "A" ? "" : safeShow(base, entry.oldPath ?? entry.path), head: entry.status === "D" ? "" : safeShow(head, entry.path) };
};

export const compileImpact = ({ base = "origin/main", head = "WORKTREE", entries, patch, selectedDomains = [], domainRegistry, authorityRegistry, fileVersions, sqlCatalogueFiles } = {}) => {
  const suppliedEntries = Boolean(entries);
  if (!entries) ({ entries, patch } = currentDiff(base, head));
  if (!fileVersions && suppliedEntries && /^diff --git /m.test(String(patch))) fileVersions = Object.fromEntries(String(patch).split(/^diff --git /m).filter(Boolean).map((section) => {
    const path = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1], headText = section.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1)).join("\n");
    return [path, { base: "", head: headText }];
  }).filter(([path]) => path));
  const domains = domainRegistry ?? registry("docs/engineering/DOMAIN_MAP.json", head).domains, facts = authorityRegistry ?? registry("docs/engineering/AUTHORITIES.json", head).facts;
  const fixtureSql = (side) => Object.entries(fileVersions ?? {}).filter(([path]) => path.endsWith(".sql")).map(([path, versions]) => ({ path, text: versions[side] ?? "" })).filter((file) => file.text).map((file) => ({ ...file, contentHash: sha256(file.text) }));
  const baseSql = sqlCatalogueFiles?.base ?? (suppliedEntries ? fixtureSql("base") : trackedSql(base)), headSql = sqlCatalogueFiles?.head ?? (suppliedEntries ? fixtureSql("head") : trackedSql(head));
  const baseCatalogue = buildSqlFunctionCatalogue(baseSql), headCatalogue = buildSqlFunctionCatalogue(headSql), mappedDomains = new Set(), effects = new Set(), unresolved = [], pathRecords = [], introducedOperations = [], removedOperations = [], baseSchemaOperations = [];
  for (const entry of entries) {
    const paths = [entry.oldPath, entry.path].filter(Boolean), matched = new Set();
    for (const domain of domains) for (const path of paths) if (domainPaths(domain).some((pattern) => matches(path, pattern))) matched.add(domain.id);
    if (paths.some(controlPath)) matched.add("engineering-control");
    const versions = versionsFor(entry, base, head, fileVersions, patch), pathEffects = paths.flatMap((path) => effectsFor(path, versions.head));
    pathEffects.forEach((effect) => effects.add(effect)); matched.forEach((domain) => mappedDomains.add(domain));
    const unknown = !matched.size && paths.some(sensitiveUnknownPath);
    if (unknown) unresolved.push({ code: "UNMAPPED_PATH", path: entry.path });
    if ((entry.status === "D" || entry.status === "R") && !matched.size) unresolved.push({ code: "STALE_PATH_MAPPING", path: entry.path, oldPath: entry.oldPath });
    const pathRisk = controlPath(entry.path) || pathEffects.some((effect) => ["WORKFLOW", "CONFIGURATION", "ENGINEERING_CONTROL", "AUTHORIZATION", "SECURITY", "DATABASE", "SCHEMA", "MONEY", "PLATFORM", "PRODUCTION"].includes(effect)) || unknown ? "R3" : pathEffects.length ? "R2" : "R0";
    pathRecords.push({ ...entry, domains: [...matched].sort(), effects: [...new Set(pathEffects)].sort(), risk: pathRisk, unknown });
    const before = parseOperations(entry.oldPath ?? entry.path, versions.base, baseCatalogue), after = parseOperations(entry.path, versions.head, headCatalogue);
    introducedOperations.push(...multisetDifference(after, before)); removedOperations.push(...multisetDifference(before, after)); baseSchemaOperations.push(...before.filter((item) => item.schemaChanging));
  }
  if (!fileVersions) for (const file of baseSql) baseSchemaOperations.push(...extractSqlOperations(file.path, file.text, { contentHash: file.contentHash, catalogue: baseCatalogue }).filter((item) => item.schemaChanging));
  const existingColumns = new Set(baseSchemaOperations.flatMap((item) => item.writtenColumns.map((column) => `${item.schema}.${item.resource}.${column}`.toLowerCase())));
  const readOperations = introducedOperations.filter((item) => item.effect === "READ"), writeOperations = introducedOperations.filter((item) => item.effect === "WRITE"), unknownOperations = introducedOperations.filter((item) => item.effect === "UNKNOWN"), relevantFunctions = new Set(introducedOperations.filter((item) => ["rpc", "function_definition"].includes(item.operationKind) && item.functionName).map((item) => item.functionName));
  for (const item of introducedOperations.filter((operation) => operation.operationKind === "rpc" && operation.functionName)) if (headCatalogue.has(item.functionName)) headCatalogue.get(item.functionName).externallyCallable = true;
  const authorityNeutralKinds = new Set(["grant_function", "revoke_function", "grant_privilege", "revoke_privilege", "policy_change", "rls_change", "create_trigger"]), expandedFunctionWrites = introducedOperations.filter((item) => ["rpc", "function_definition"].includes(item.operationKind) && item.effect === "WRITE").flatMap((item) => (headCatalogue.get(item.functionName)?.effectiveWrites ?? []).map((write) => ({ ...write, sourcePath: item.sourcePath, functionName: null }))), concreteWrites = [...writeOperations.filter((item) => !["rpc", "function_definition"].includes(item.operationKind) && !authorityNeutralKinds.has(item.operationKind)), ...expandedFunctionWrites], authority = resolveWriteAuthorities([...concreteWrites, ...unknownOperations.filter((item) => !["rpc", "function_definition"].includes(item.operationKind))], facts, { existingColumns }), functionAuthority = deriveFunctionAuthorities(headCatalogue, facts, { existingColumns, functionNames: relevantFunctions });
  unresolved.push(...authority.unresolved, ...functionAuthority.unresolved, ...unknownOperations.filter((item) => item.operationKind === "rpc").map((item) => ({ code: item.analysisError ?? "RPC_EFFECT_UNKNOWN", functionName: item.functionName, sourcePath: item.sourcePath })));
  for (const resolution of authority.resolutions) {
    const relevantIds = pathRecords.find((record) => record.path === resolution.sourcePath || record.oldPath === resolution.sourcePath)?.domains ?? [], relevant = relevantIds.map((id) => domains.find((domain) => domain.id === id)).filter(Boolean);
    if (!relevant.some((domain) => (domain.authorityRefs ?? []).includes(resolution.authority) && !(domain.mustNotWriteAuthorityRefs ?? []).includes(resolution.authority))) unresolved.push({ code: "PROHIBITED_WRITE_AUTHORITY", target: resolution.target, authority: resolution.authority, sourcePath: resolution.sourcePath, relevantDomains: relevant.map((domain) => domain.id).sort() });
  }
  for (const entry of entries) { const migration = /^supabase\/migrations\/(\d+)_/.exec(entry.path); if (migration && Number(migration[1]) <= 51) unresolved.push({ code: "IMMUTABLE_MIGRATION", path: entry.path }); }
  const domainRisk = [...mappedDomains].map((id) => domains.find((domain) => domain.id === id)?.riskFloor ?? (id === "engineering-control" ? "R3" : "R0"));
  return {
    schemaVersion: 3, baseSha: git("rev-parse", base), headSha: head === "WORKTREE" ? git("rev-parse", "HEAD") : git("rev-parse", head), treeSha: head === "WORKTREE" ? git("rev-parse", "HEAD^{tree}") : git("rev-parse", `${head}^{tree}`), dirtyFingerprint: dirtyFingerprint(),
    changes: pathRecords, changedPaths: [...new Set(entries.flatMap((entry) => [entry.oldPath, entry.path].filter(Boolean)))], domains: [...mappedDomains].sort(), contextDomainHints: [...new Set(selectedDomains)].sort(), effects: [...effects].sort(), changedAuthorities: [...new Set(authority.resolutions.map((item) => item.authority))].sort(),
    writeOperations, readOperations, unknownOperations, removedOperations, writeResolutions: authority.resolutions, sharedResources: authority.sharedResources, functionAuthorities: functionAuthority.results, registryReconciliations: functionAuthority.reconciliations,
    risk: maxRisk(...domainRisk, ...pathRecords.map((entry) => entry.risk), introducedOperations.length || unresolved.some((item) => item.code.includes("AUTHORITY")) ? "R3" : "R0"), unresolved, writable: unresolved.length === 0,
    impactHash: sha256(JSON.stringify({ entries, introduced: introducedOperations.map((item) => item.operationIdentity), removed: removedOperations.map((item) => item.operationIdentity) })),
  };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { value } = parseArgs(), result = compileImpact({ base: value("--base", "origin/main"), head: value("--head", "WORKTREE") });
  console.log(JSON.stringify(result, null, 2)); if (!result.writable) process.exitCode = 2;
}
