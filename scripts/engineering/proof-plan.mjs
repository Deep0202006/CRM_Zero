import { resolve } from "node:path";
import { compileImpact } from "./impact.mjs";
import { parseArgs, readJson, sha256 } from "./kernel-lib.mjs";

export const proofKinds = ["unit", "build", "postgres", "e2e", "handover", "owner-pre", "owner-post"];
const expensiveKinds = new Set(["build", "postgres", "e2e"]);
const matchesPath = (path, pattern) => pattern.endsWith("/**") ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2)) : path === pattern || path.startsWith(`${pattern}/`);
const overlaps = (left = [], right = []) => left.some((value) => right.includes(value));
const selectorMatches = (proof, impact) => {
  const selectors = proof.selectors ?? {};
  return (selectors.paths?.some((pattern) => impact.changedPaths.some((path) => matchesPath(path, pattern))) ?? false)
    || overlaps(selectors.effects, impact.effects)
    || overlaps(selectors.authorities, impact.changedAuthorities)
    || overlaps(selectors.capabilities, impact.changedCapabilities);
};
const selectionFor = (policy, proofId) => Object.entries(policy).find(([, ids]) => ids.includes(proofId))?.[0];

export const validateSelectionRegistry = (registry) => {
  const ids = new Set(registry.proofs.map((proof) => proof.id)), seen = new Set();
  for (const [selection, proofIds] of Object.entries(registry.selectionPolicy ?? {})) for (const id of proofIds) {
    if (!ids.has(id)) throw new Error(`PROOF_SELECTION_UNKNOWN:${selection}:${id}`);
    if (seen.has(id)) throw new Error(`PROOF_SELECTION_DUPLICATE:${id}`);
    seen.add(id);
  }
  for (const proof of registry.proofs) {
    if (!seen.has(proof.id)) throw new Error(`PROOF_SELECTION_MISSING:${proof.id}`);
    if (expensiveKinds.has(proof.kind) && (proof.effects ?? []).includes("ALL_CHANGES")) throw new Error(`EXPENSIVE_GLOBAL_SELECTOR_FORBIDDEN:${proof.id}`);
  }
  return true;
};

export const compileProofPlan = ({ base = "origin/main", head = "WORKTREE", impact, requestedProofIds = [], fullRegression = false } = {}) => {
  impact ??= compileImpact({ base, head });
  if (!impact.writable) throw new Error(`IMPACT_UNRESOLVED:${(impact.unresolved ?? []).map((item) => item.code).join(",")}`);
  const domainRegistry = readJson("docs/engineering/DOMAIN_MAP.json"), domains = domainRegistry.domains;
  const registry = readJson("docs/engineering/PROOFS.json"); validateSelectionRegistry(registry);
  const proofs = registry.proofs, mapped = domains.filter((domain) => impact.domains.includes(domain.id)), requested = new Set(requestedProofIds);
  const canonical = new Set(mapped.flatMap((domain) => domainRegistry.canonicalDomainProofRefs?.[domain.id] ?? domain.proofRefs ?? []));
  const requiredKinds = new Set(mapped.flatMap((domain) => domain.requiredProofKinds ?? [])), reasons = {};
  const ledgerOnly = impact.effects.length === 1 && impact.effects[0] === "OWNER_LEDGER_TRANSITION";
  let selected = proofs.filter((proof) => {
    const selection = selectionFor(registry.selectionPolicy, proof.id), domainHit = overlaps(proof.domains, impact.domains), selectorHit = selectorMatches(proof, impact);
    const domainChanges = impact.changes.filter((change) => overlaps(change.domains, proof.domains));
    const domainEffects = domainChanges.flatMap((change) => change.effects), proofPathHit = (proof.paths ?? []).some((pattern) => impact.changedPaths.some((path) => matchesPath(path, pattern)));
    const domainSourceHit = domainChanges.some((change) => !/^e2e\//.test(change.path) && !/(?:^|\/)(?:__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$|\.sql$|^docs\//.test(change.path));
    let reason = null;
    if (requested.has(proof.id)) reason = "EXPLICIT_REQUEST";
    else if (selection === "always-cheap") reason = "ALWAYS_CHEAP";
    else if (selection === "control" && impact.domains.includes("engineering-control") && (!ledgerOnly || proof.id === "owner-ledger-invariant") && (canonical.has(proof.id) || !proof.selectors || selectorHit)) reason = canonical.has(proof.id) ? "CANONICAL_CONTROL_PROOF" : "CONTROL_SELECTOR";
    else if (selection === "domain" && canonical.has(proof.id) && (domainSourceHit || proofPathHit)) reason = "CANONICAL_DOMAIN_PROOF";
    else if (selection === "domain" && selectorHit && (proof.selectors?.global || domainHit)) reason = "PROOF_SELECTOR";
    else if (selection === "domain" && domainHit && proof.kind === "postgres" && overlaps(domainEffects, ["DATABASE", "SCHEMA", "RLS"])) reason = "DOMAIN_DATABASE_EFFECT";
    else if (selection === "domain" && domainHit && proof.kind === "e2e" && domainEffects.includes("USER_JOURNEY")) reason = "DOMAIN_USER_JOURNEY_EFFECT";
    else if (selection === "explicit" && selectorHit) reason = "EXACT_EXPLICIT_SELECTOR";
    else if (selection === "full-regression" && fullRegression) reason = "FULL_REGRESSION_REQUEST";
    if (reason) reasons[proof.id] = reason;
    return Boolean(reason);
  });
  for (const kind of ["postgres", "e2e"]) if (selected.some((proof) => proof.kind === kind && !proof.representativeBackend)) selected = selected.filter((proof) => { if (proof.kind === kind && proof.representativeBackend) { delete reasons[proof.id]; return false; } return true; });
  for (const kind of requiredKinds) if (!selected.some((proof) => proof.kind === kind)) throw new Error(`PROOF_UNMAPPED:${kind}`);
  if (impact.risk === "R3" && !selected.some((proof) => proof.kind === "unit")) throw new Error("PROOF_UNMAPPED:unit");
  const plan = {
    schemaVersion: 2,
    ...impact,
    requestedProofIds: [...requested].sort(),
    fullRegression,
    requiredProofs: selected.map((proof) => proof.id),
    reuseEligibleProofs: ledgerOnly ? proofs.filter((proof) => ["domain", "explicit"].includes(selectionFor(registry.selectionPolicy, proof.id)) && ["unit", "build", "postgres", "e2e"].includes(proof.kind)).map((proof) => proof.id) : [],
    selectionReasons: reasons,
    requiredByKind: Object.fromEntries(proofKinds.map((kind) => [kind, selected.filter((proof) => proof.kind === kind).map((proof) => proof.id)])),
    notRequiredKinds: proofKinds.filter((kind) => !selected.some((proof) => proof.kind === kind)),
    forbiddenWrites: ["production", ...mapped.flatMap((domain) => domain.mustNotWriteAuthorityRefs ?? [])],
  };
  plan.planHash = sha256(JSON.stringify(plan));
  return plan;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = parseArgs(), requestedProofIds = String(args.value("--proof", "")).split(",").filter(Boolean);
  try { console.log(JSON.stringify(compileProofPlan({ base: args.value("--base", "origin/main"), head: args.value("--head", "WORKTREE"), requestedProofIds, fullRegression: args.has("--full-regression") }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
