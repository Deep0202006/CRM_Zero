import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSourceIndex } from "./source-index.mjs";
import { parseArgs, readJson, root, sha256 } from "./kernel-lib.mjs";

const matchesRoot = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const words = (value) => new Set(String(value).toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []);
export const resolveContext = ({ task = "", exactPath, index } = {}) => {
  index ??= buildSourceIndex({ includePaths: exactPath ? [exactPath] : [] });
  const taskHash = sha256(task), taskWords = words(task), domains = readJson("docs/engineering/DOMAIN_MAP.json").domains;
  const authorities = readJson("docs/engineering/AUTHORITIES.json").facts;
  const capabilities = readJson("docs/engineering/CAPABILITIES.json").capabilities;
  const proofs = readJson("docs/engineering/PROOFS.json").proofs;
  const domainScores = domains.map((domain) => {
    let score = 0;
    if (exactPath && [...(domain.surfacePaths ?? []), ...(domain.codeRoots ?? []), ...(domain.serverBoundaries ?? []), ...(domain.contractPaths ?? []), ...(domain.criticalTests ?? []), ...(domain.pathPatterns ?? [])].some((path) => matchesRoot(exactPath, path))) score = 1;
    for (const alias of [domain.id, ...(domain.aliases ?? [])]) if ([...words(alias)].every((word) => taskWords.has(word))) score = Math.max(score, 0.85);
    return { domain, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const selected = domainScores.filter((item) => item.score === domainScores[0]?.score).map((item) => item.domain);
  const evidence = [];
  for (const file of index.files) {
    const matchedBy = [];
    let score = 0;
    if (exactPath && file.path === exactPath) { score = 1; matchedBy.push({ kind: "exact-identifier", value: exactPath }); }
    for (const domain of selected) for (const [paths, weight] of [[domain.serverBoundaries ?? [], 0.8], [domain.codeRoots ?? [], 0.75], [domain.criticalTests ?? [], 0.7], [domain.surfacePaths ?? [], 0.8], [domain.contractPaths ?? [], 0.75]]) for (const path of paths) if (matchesRoot(file.path, path)) { score = Math.max(score, weight); matchedBy.push({ kind: "registry", value: `${domain.id}:${path}` }); }
    for (const value of [...file.tables, ...file.rpcs, ...file.routes, ...file.exports]) if (score > 0 && taskWords.has(String(value).toLowerCase())) { score = 1; matchedBy.push({ kind: file.tables.includes(value) ? "table" : file.rpcs.includes(value) ? "rpc" : file.routes.includes(value) ? "route" : "exact-identifier", value }); }
    const baseName = file.path.split("/").at(-1).replace(/\.[^.]+$/, "");
    if (taskWords.has(baseName.toLowerCase())) { score = Math.max(score, 0.45); matchedBy.push({ kind: "filename", value: baseName }); }
    if (score) evidence.push({ path: file.path, contentHash: file.contentHash, score, matchedBy: [...new Map(matchedBy.map((item) => [`${item.kind}:${item.value}`, item])).values()] });
  }
  evidence.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const bounded = [];
  for (const domain of selected) {
    const representative = (domain.codeRoots ?? []).map((path) => evidence.find((candidate) => matchesRoot(candidate.path, path))).find(Boolean) ?? evidence.find((candidate) => (domain.serverBoundaries ?? []).some((path) => matchesRoot(candidate.path, path)));
    if (representative && !bounded.includes(representative)) bounded.push(representative);
  }
  for (const candidate of evidence) if (bounded.length < 7 && !bounded.includes(candidate)) bounded.push(candidate);
  bounded.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const top = evidence[0]?.score ?? 0, margin = top - (evidence[1]?.score ?? 0);
  const authoritySets = selected.map((domain) => new Set(domain.authorityRefs ?? []));
  const conflicting = authoritySets.some((left, index) => left.size && authoritySets.slice(index + 1).some((right) => right.size && ![...left].some((id) => right.has(id))));
  const lexicalOnly = evidence.length && evidence.every((candidate) => candidate.matchedBy.every((match) => match.kind === "filename"));
  const lowMargin = !exactPath && evidence.length > 1 && margin < 0.1;
  const status = !selected.length || !evidence.length ? "UNKNOWN" : conflicting || lexicalOnly || top < 0.7 || lowMargin ? "SCOPE_AMBIGUOUS" : "RESOLVED";
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
    unresolved: [!selected.length && "NO_DOMAIN_EVIDENCE", !evidence.length && "NO_PATH_EVIDENCE", conflicting && "CONFLICTING_AUTHORITIES", lexicalOnly && "LEXICAL_ONLY", top < 0.7 && "LOW_CONFIDENCE", lowMargin && "LOW_MARGIN"].filter(Boolean),
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
