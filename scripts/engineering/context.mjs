import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const json = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
const map = json("docs/engineering/DOMAIN_MAP.json");
const authorities = json("docs/engineering/AUTHORITIES.json").facts;
const capabilities = json("docs/engineering/CAPABILITIES.json").capabilities;
const lessons = json("docs/engineering/LESSONS.json").lessons;
const effects = new Set(["UI", "API", "DATABASE", "AUTHORIZATION", "OFFLINE", "IMPORT", "ANALYTICS", "EXPORT", "SECURITY"]);
const args = process.argv.slice(2);
const values = (name) => args.flatMap((arg, index) => arg === name && args[index + 1] ? [args[index + 1]] : []);
const stop = (code) => { console.error(code); process.exit(2); };
const domainsArg = values("--domain");
const paths = values("--path");
const requestedEffects = values("--effect");
const task = values("--task").at(-1) ?? "";
const mode = values("--mode").at(-1) ?? "focused";
const budgetValue = values("--budget").at(-1) ?? "1500";
const budget = Number(budgetValue);
if (!Number.isInteger(budget) || budget <= 0) stop("INVALID_BUDGET");
if (!new Set(["focused", "platform"]).has(mode)) stop("INVALID_MODE");
if (requestedEffects.some((effect) => !effects.has(effect))) stop("INVALID_EFFECT");
const byId = new Map(map.domains.map((domain) => [domain.id, domain]));
const rank = { R0: 0, R1: 1, R2: 2, R3: 3 };
const tokens = (value) => [...new Set(String(value).normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}_-]+/gu)?.flatMap((token) => token.split(/[_-]+/)).filter((token) => token.length > 1) ?? [])];
const taskTokens = new Set(tokens(task));
const briefAuthority = (item) => ({ id: item.id, authority: item.authority, owns: item.owns, mustNotOwn: item.mustNotOwn });
const briefCapability = (item) => ({ id: item.id, reuse: item.reuse, implementationPaths: item.implementationPaths, testPaths: item.testPaths });
const briefLesson = (item) => ({ id: item.id, rule: item.rule });

if (mode === "platform") {
  const pack = {
    mode: "platform", scope: "platform", risk: "R3", budget, architecture: "docs/engineering/ARCHITECTURE.md",
    domainIndex: map.domains.map(({ id, riskFloor, authorityRefs }) => ({ id, riskFloor, authorityRefs })),
    contractIndex: [...new Set(map.domains.flatMap((domain) => domain.contractPaths ?? []))],
    criticalPlatformRoots: ["src/app", "src/lib", "src/context", "supabase", "docs/contracts", "scripts", ".github/workflows", "package.json", "public"],
    nextStep: "Resolve focused context for each affected write before changing product or schema."
  };
  const estimatedTokens = Math.ceil(JSON.stringify(pack).length / 4);
  if (estimatedTokens > budget) stop("CONTEXT_REQUIRED_BUDGET_EXCEEDED");
  console.log(JSON.stringify({ ...pack, estimatedTokens }, null, 2));
  process.exit(0);
}

const selected = new Set(domainsArg);
for (const id of selected) if (!byId.has(id)) stop("UNMAPPED_PATH");
for (const path of paths) {
  const matches = map.domains.filter((domain) => ["surfacePaths", "codeRoots", "serverBoundaries"].some((key) => (domain[key] ?? []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`))));
  if (!matches.length) stop("UNMAPPED_PATH");
  matches.forEach((domain) => selected.add(domain.id));
}
// Task-only discovery is intentionally evidence ranking, never authorization.
// A tie fails closed instead of guessing a writable domain.
if (!selected.size && task) {
  const sameToken = (left, right) => left === right || left.replace(/s$/, "") === right.replace(/s$/, "");
  const scoreText = (value) => tokens(value).filter((token) => [...taskTokens].some((taskToken) => sameToken(token, taskToken))).length;
  const candidates = map.domains.map((domain) => {
    const authorityText = (domain.authorityRefs ?? []).map((id) => authorities.find((item) => item.id === id)).filter(Boolean).flatMap((item) => [item.id, ...(item.owns ?? []), item.authority ?? ""]);
    const capabilityText = (domain.capabilityRefs ?? []).map((id) => capabilities.find((item) => item.id === id)).filter(Boolean).flatMap((item) => [item.id, ...(item.notes ?? [])]);
    const direct = scoreText([domain.id, ...(domain.aliases ?? [])].join(" "));
    return { domain, direct, score: direct * 5 + scoreText([...(domain.surfacePaths ?? []), ...authorityText, ...capabilityText].join(" ")) };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || a.domain.id.localeCompare(b.domain.id));
  if (!candidates.length) stop("CONTEXT_AMBIGUOUS");
  const confirmed = candidates.filter((candidate) => candidate.direct > 0 && candidate.score >= candidates[0].score - 1);
  if (confirmed.length > 1) confirmed.forEach((candidate) => selected.add(candidate.domain.id));
  else if (candidates[1] && candidates[0].score === candidates[1].score) stop("CONTEXT_AMBIGUOUS");
  else selected.add(candidates[0].domain.id);
}
if (!selected.size) stop("UNMAPPED_PATH");
const domains = [...selected].map((id) => byId.get(id));
let risk = domains.reduce((current, domain) => rank[domain.riskFloor] > rank[current] ? domain.riskFloor : current, "R0");
if (requestedEffects.some((effect) => ["DATABASE", "AUTHORIZATION", "SECURITY"].includes(effect))) risk = "R3";
const ids = (key) => [...new Set(domains.flatMap((domain) => domain[key] ?? []))];
const authorityIds = ids("authorityRefs");
if (requestedEffects.some((effect) => ["DATABASE", "AUTHORIZATION"].includes(effect)) && !authorityIds.length) stop("AUTHORITY_UNRESOLVED");
const intersectsDomain = (lesson) => (lesson.domains ?? []).includes("all") || (lesson.domains ?? []).some((id) => selected.has(id));
const matchesTask = (lesson) => intersectsDomain(lesson) && (lesson.risk ?? []).includes(risk) && (lesson.triggers ?? []).some((trigger) => tokens(trigger).every((token) => taskTokens.has(token)));
const add = (bucket, reason, lesson) => { if (!bucket.has(lesson.id)) bucket.set(lesson.id, { lesson, reasons: [] }); bucket.get(lesson.id).reasons.push(reason); };
const chosen = new Map();
for (const lesson of lessons.filter((lesson) => lesson.loadByDefault)) add(chosen, "default", lesson);
for (const id of requestedEffects.flatMap((effect) => map.effectLessonRefs?.[effect] ?? [])) { const lesson = lessons.find((item) => item.id === id); if (lesson) add(chosen, "effect", lesson); }
for (const lesson of lessons.filter(matchesTask)) add(chosen, "task-trigger", lesson);
for (const id of ids("lessonRefs")) { const lesson = lessons.find((item) => item.id === id); if (lesson) add(chosen, "domain", lesson); }
const mandatory = new Set([...chosen.values()].filter(({ reasons }) => reasons.some((reason) => reason !== "domain")).map(({ lesson }) => lesson.id));
const optional = [...chosen.values()].filter(({ lesson }) => !mandatory.has(lesson.id));
const build = (entries, omittedLessons = []) => {
  const lessonSelection = Object.fromEntries(entries.map(({ lesson, reasons }) => [lesson.id, [...new Set(reasons)]]));
  const pack = {
    mode: "focused", scope: domains.length === 1 ? "focused" : "cross-domain", budget,
    domains: domains.map((domain) => domain.id), risk, contracts: ids("contractPaths").slice(0, 3),
    authorities: authorities.filter((item) => authorityIds.includes(item.id)).map(briefAuthority),
    capabilities: capabilities.filter((item) => ids("capabilityRefs").includes(item.id)).slice(0, 4).map(briefCapability),
    lessons: entries.map(({ lesson }) => briefLesson(lesson),), lessonSelection, omittedLessons,
    mustNotWriteAuthorities: ids("mustNotWriteAuthorityRefs"), criticalTests: ids("criticalTests"), serverBoundaries: ids("serverBoundaries")
  };
  return { pack, estimatedTokens: Math.ceil(JSON.stringify(pack).length / 4) };
};
let included = [...chosen.values()]; let omittedLessons = []; let result = build(included, omittedLessons);
while (result.estimatedTokens > budget && optional.length) {
  const removed = optional.pop(); included = included.filter(({ lesson }) => lesson.id !== removed.lesson.id); omittedLessons.push(removed.lesson.id); result = build(included, omittedLessons);
}
if (result.estimatedTokens > budget) stop("CONTEXT_REQUIRED_BUDGET_EXCEEDED");
console.log(JSON.stringify({ ...result.pack, estimatedTokens: result.estimatedTokens }, null, 2));
