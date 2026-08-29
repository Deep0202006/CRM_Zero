import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { buildSourceIndex } from "./source-index.mjs";
import { git, parseArgs, readJson, root, safeEnvironment, sha256 } from "./kernel-lib.mjs";

const matchesRoot = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const words = (value) => new Set(String(value).toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []);
const includesWords = (taskWords, value) => {
  const required = [...words(value)];
  return required.length > 0 && required.every((word) => taskWords.has(word));
};
const roleFor = (path, reason) => /(?:^|\/)(?:__tests__|e2e)(?:\/|$)|\.(?:test|spec)\./i.test(path) ? "test" : /^docs\/contracts\//.test(path) ? "contract" : /^src\/app\/api\//.test(path) ? "server" : reason === "REVERSE_IMPORT" ? "reader" : "implementation";
const relationshipKinds = new Set(["IMPORT", "REVERSE_IMPORT", "RELATED_TEST"]);
const graphifyFor = (task, index) => {
  const fallback = { status: "TARGETED_SOURCE_FALLBACK", evidenceType: "fallback", confidence: 0, paths: [], grantsAuthority: false };
  const graph = resolve(root, "graphify-out/graph.json"), stamp = resolve(root, "graphify-out/.crm-head");
  if (!task || !existsSync(graph) || !existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== git("rev-parse", "HEAD") || git("status", "--porcelain", "--untracked-files=no")) return fallback;
  const environment = safeEnvironment(), executable = process.env.GRAPHIFY_BIN ?? "graphify", probe = spawnSync(executable, ["--version"], { cwd: root, encoding: "utf8", env: environment });
  if (probe.error || probe.status !== 0) return fallback;
  const query = spawnSync(executable, ["query", task, "--budget", "500"], { cwd: root, encoding: "utf8", env: { ...environment, GRAPHIFY_QUERY_LOG_DISABLE: "1" } });
  if (query.status !== 0) return { ...fallback, status: "GRAPHIFY_QUERY_FAILED" };
  const paths = [...new Set(query.stdout.match(/(?:src|scripts|e2e|supabase)\/[A-Za-z0-9_./\[\]-]+/g) ?? [])].flatMap((path) => {
    const file = index.files.find((candidate) => candidate.path === path);
    if (file) return [{ path, contentHash: file.contentHash }];
    try {
      if (git("ls-files", "--error-unmatch", path) !== path) return [];
      return [{ path, contentHash: sha256(readFileSync(resolve(root, path))) }];
    } catch { return []; }
  }).slice(0, 5);
  return { status: "GRAPHIFY_BOUNDED", evidenceType: "INFERRED", confidence: 0.82, paths, grantsAuthority: false };
};
export const resolveContext = ({ task = "", exactPath, index } = {}) => {
  const suppliedIndex = Boolean(index);
  index ??= buildSourceIndex({ includePaths: exactPath ? [exactPath] : [] });
  const taskHash = sha256(task), taskWords = words(task), domains = readJson("docs/engineering/DOMAIN_MAP.json").domains;
  const authorities = readJson("docs/engineering/AUTHORITIES.json").facts;
  const capabilities = readJson("docs/engineering/CAPABILITIES.json").capabilities;
  const proofs = readJson("docs/engineering/PROOFS.json").proofs;
  const domainForPath = (domain, path) => [...(domain.surfacePaths ?? []), ...(domain.codeRoots ?? []), ...(domain.serverBoundaries ?? []), ...(domain.contractPaths ?? []), ...(domain.criticalTests ?? []), ...(domain.pathPatterns ?? [])].some((pattern) => matchesRoot(path, pattern));
  const domainScores = domains.map((domain) => {
    let score = exactPath && domainForPath(domain, exactPath) ? 1 : 0;
    for (const alias of [domain.id, ...(domain.aliases ?? [])]) if (includesWords(taskWords, alias)) score = Math.max(score, 0.9);
    for (const file of index.files.filter((item) => domainForPath(domain, item.path))) for (const value of [...file.tables, ...file.rpcs, ...file.routes, ...file.exports]) if (includesWords(taskWords, value)) {
      const valueWords = words(value), owns = [domain.id, ...(domain.aliases ?? [])].some((alias) => includesWords(valueWords, alias) || includesWords(words(alias), value));
      score = Math.max(score, owns ? 1 : 0.84);
    }
    return { domain, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.domain.id.localeCompare(b.domain.id));
  const topDomainScore = domainScores[0]?.score ?? 0;
  const selected = domainScores.filter((item) => topDomainScore - item.score < 0.06).map((item) => item.domain);
  const evidence = new Map();
  const add = (file, score, kind, value, role, evidenceType = "EXTRACTED") => {
    if (!file) return;
    const existing = evidence.get(file.path) ?? { path: file.path, contentHash: file.contentHash, score: 0, role: role ?? roleFor(file.path, kind), evidenceType, confidence: score, matchedBy: [] };
    existing.score = Math.max(existing.score, score);
    existing.confidence = Math.max(existing.confidence, score);
    if (existing.evidenceType !== "EXTRACTED") existing.evidenceType = evidenceType;
    existing.role = existing.role === "implementation" && role ? role : existing.role;
    if (!existing.matchedBy.some((item) => item.kind === kind && item.value === value)) existing.matchedBy.push({ kind, value, evidenceType, confidence: score });
    evidence.set(file.path, existing);
  };
  for (const file of index.files) {
    if (exactPath && file.path === exactPath) add(file, 1, "EXACT_PATH", exactPath);
    for (const domain of selected) {
      for (const path of domain.serverBoundaries ?? []) if (matchesRoot(file.path, path)) add(file, 0.92, "SERVER_BOUNDARY", `${domain.id}:${path}`, "server");
      for (const path of domain.surfacePaths ?? []) if (matchesRoot(file.path, path)) add(file, 0.9, "SURFACE_PATH", `${domain.id}:${path}`);
      for (const path of domain.criticalTests ?? []) if (matchesRoot(file.path, path)) add(file, 0.76, "RELATED_TEST", `${domain.id}:${path}`, "test");
      for (const path of [...(domain.codeRoots ?? []), ...(domain.contractPaths ?? [])]) if (matchesRoot(file.path, path)) add(file, 0.7, "DOMAIN_REGISTRY", `${domain.id}:${path}`);
      if (domainForPath(domain, file.path)) for (const authority of authorities.filter((item) => (domain.authorityRefs ?? []).includes(item.id))) if (includesWords(taskWords, authority.id) || includesWords(taskWords, authority.authority)) add(file, 0.95, "AUTHORITY", authority.id);
    }
    if (selected.some((domain) => domainForPath(domain, file.path))) for (const [kind, values] of [["TABLE", file.tables], ["RPC", file.rpcs], ["ROUTE", file.routes], ["EXPORTED_SYMBOL", file.exports]]) for (const value of values) if (includesWords(taskWords, value)) add(file, 1, kind, value);
    const baseName = file.path.split("/").at(-1).replace(/\.[^.]+$/, "");
    if (taskWords.has(baseName.toLowerCase())) add(file, 0.4, "FILENAME", baseName);
  }
  const directSeeds = [...evidence.values()].filter((candidate) => candidate.score >= 0.9);
  for (const seed of directSeeds) {
    const file = index.files.find((candidate) => candidate.path === seed.path);
    for (const path of file?.reverseImports ?? []) add(index.files.find((candidate) => candidate.path === path), 0.84, "REVERSE_IMPORT", seed.path, "reader");
    for (const path of file?.imports ?? []) add(index.files.find((candidate) => candidate.path === path), 0.8, "IMPORT", seed.path);
    for (const path of file?.relatedTests ?? []) add(index.files.find((candidate) => candidate.path === path), 0.78, "RELATED_TEST", seed.path, "test");
    for (const path of file?.testedSources ?? []) add(index.files.find((candidate) => candidate.path === path), 0.78, "RELATED_TEST", seed.path);
  }
  const graphifyEvidence = suppliedIndex ? { status: "TEST_INDEX_FALLBACK", evidenceType: "fallback", confidence: 0, paths: [], grantsAuthority: false } : graphifyFor(task, index);
  for (const structural of graphifyEvidence.paths) add({ ...structural, imports: [], reverseImports: [], relatedTests: [], testedSources: [] }, graphifyEvidence.confidence, "GRAPHIFY", task, undefined, "INFERRED");
  const ordered = [...evidence.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const bounded = [];
  const take = (candidate) => { if (candidate && bounded.length < 7 && !bounded.some((item) => item.path === candidate.path)) bounded.push(candidate); };
  take(ordered.find((candidate) => ["implementation", "server"].includes(candidate.role)));
  take(ordered.find((candidate) => candidate.role === "test"));
  take(ordered.find((candidate) => candidate.matchedBy.some((reason) => relationshipKinds.has(reason.kind))));
  for (const domain of selected) take(ordered.find((candidate) => (domain.serverBoundaries ?? []).some((path) => matchesRoot(candidate.path, path))));
  for (const domain of selected) for (const path of domain.codeRoots ?? []) take(ordered.find((candidate) => matchesRoot(candidate.path, path)));
  for (const domain of selected) take(ordered.find((candidate) => domainForPath(domain, candidate.path)));
  for (const candidate of ordered) take(candidate);
  bounded.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const authoritySets = selected.map((domain) => new Set(domain.authorityRefs ?? []));
  const conflicting = authoritySets.some((left, index) => left.size && authoritySets.slice(index + 1).some((right) => right.size && ![...left].some((id) => right.has(id))));
  const lexicalOnly = ordered.length > 0 && ordered.every((candidate) => candidate.matchedBy.every((match) => match.kind === "FILENAME"));
  const relationshipOnly = ordered.length > 0 && ordered.every((candidate) => candidate.matchedBy.every((match) => relationshipKinds.has(match.kind)));
  const status = !selected.length || !ordered.length ? "UNKNOWN" : conflicting || lexicalOnly || relationshipOnly || ordered[0].score < 0.68 ? "SCOPE_AMBIGUOUS" : "RESOLVED";
  const authorityIds = new Set(selected.flatMap((domain) => domain.authorityRefs ?? []));
  const protectedIds = new Set(selected.flatMap((domain) => domain.mustNotWriteAuthorityRefs ?? []));
  const capabilityIds = new Set(selected.flatMap((domain) => domain.capabilityRefs ?? []));
  const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 };
  const risk = selected.reduce((current, domain) => riskRank[domain.riskFloor] > riskRank[current] ? domain.riskFloor : current, "R0");
  return {
    status, taskHash, domains: selected.map((domain) => domain.id), risk,
    authorities: authorities.filter((item) => authorityIds.has(item.id)).map((item) => item.id),
    mustNotWriteAuthorities: authorities.filter((item) => protectedIds.has(item.id)).map((item) => item.id),
    capabilities: capabilities.filter((item) => capabilityIds.has(item.id)).map((item) => item.id),
    candidatePaths: bounded, requiredOpenPaths: status === "RESOLVED" ? bounded.map((item) => item.path) : [],
    requiredProofRefs: [...new Set([...selected.flatMap((domain) => domain.proofRefs ?? []), ...proofs.filter((proof) => (proof.domains ?? []).some((domain) => selected.some((item) => item.id === domain))).map((proof) => proof.id)])],
    graphifyEvidence,
    unresolved: [!selected.length && "NO_DOMAIN_EVIDENCE", !ordered.length && "NO_PATH_EVIDENCE", conflicting && "CONFLICTING_AUTHORITIES", lexicalOnly && "LEXICAL_ONLY", relationshipOnly && "RELATIONSHIP_ONLY", ordered[0]?.score < 0.68 && "LOW_CONFIDENCE"].filter(Boolean),
  };
};
export const revalidateCandidate = (candidate) => {
  try { return sha256(readFileSync(resolve(root, candidate.path))) === candidate.contentHash; }
  catch { return false; }
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { value } = parseArgs(), pack = resolveContext({ task: value("--task", ""), exactPath: value("--path") });
  console.log(JSON.stringify(pack, null, 2));
  if (pack.status !== "RESOLVED") process.exitCode = 2;
}
