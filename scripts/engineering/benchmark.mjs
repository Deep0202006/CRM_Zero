import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { buildSourceIndex } from "./source-index.mjs";
import { resolveContext } from "./context.mjs";
import { classifyCommand, CommandClass } from "./command-policy.mjs";
import { compileRegisteredCommandPlan } from "./proof-command-plan.mjs";
import { compileProofPlan } from "./proof-plan.mjs";
import { git, parseArgs, readJson } from "./kernel-lib.mjs";

const percentage = (value, total) => total ? Math.round(value * 10000 / total) / 100 : 100;
const matches = (path, patterns = []) => patterns.some((pattern) => path.toLowerCase().includes(pattern.toLowerCase()));
const fakeSha = (letter) => letter.repeat(40);
const impact = ({ path, domains, effects, writable = true, authorities = [] }) => ({
  schemaVersion: 3, baseSha: fakeSha("a"), headSha: fakeSha("b"), treeSha: fakeSha("c"), dirtyFingerprint: "0".repeat(64), impactHash: `${path}:${domains.join(",")}:${effects.join(",")}`,
  changes: [{ status: "M", path, domains, effects, risk: writable ? "R2" : "R3", unknown: !writable }], changedPaths: [path], domains, contextDomainHints: [], effects, changedAuthorities: authorities,
  writeOperations: [], readOperations: [], unknownOperations: [], removedOperations: [], writeResolutions: [], sharedResources: [], functionAuthorities: [], registryReconciliations: [], risk: effects.some((effect) => ["DATABASE", "AUTHORIZATION", "ENGINEERING_CONTROL"].includes(effect)) ? "R3" : "R2", unresolved: writable ? [] : [{ code: "UNMAPPED_PATH", path }], writable,
});
const economyCases = [
  { id: "calls-ui", impact: impact({ path: "src/app/call-logs/page.tsx", domains: ["calls"], effects: ["UI", "TYPESCRIPT", "RUNTIME_BUILD"] }), forbidden: ["control-postgres-matrix", "control-e2e-matrix", "product-054-postgres"], required: ["calls-unit"] },
  { id: "calls-server-auth", impact: impact({ path: "src/app/api/call-logs/confirm/route.ts", domains: ["calls"], effects: ["API", "AUTHORIZATION", "SECURITY", "TYPESCRIPT", "RUNTIME_BUILD"] }), forbiddenKinds: ["postgres"], required: ["calls-unit", "auth-unit"] },
  { id: "mapping-ui", impact: impact({ path: "src/app/mappings/page.tsx", domains: ["mappings"], effects: ["UI", "TYPESCRIPT", "RUNTIME_BUILD"] }), forbidden: ["calls-unit", "distributor-postgres", "receivables-postgres"] },
  { id: "authority-migration", impact: impact({ path: "supabase/migrations/055_receivables_guard.sql", domains: ["receivables"], effects: ["DATABASE", "SCHEMA", "AUTHORIZATION"], authorities: ["receivable_financials"] }), required: ["receivables-postgres"], forbidden: ["control-postgres-matrix", "control-e2e-matrix"] },
  { id: "sql-fixture", impact: impact({ path: "scripts/receivables-db/fixture.sql", domains: ["receivables"], effects: ["DATABASE", "SCHEMA"] }), required: ["receivables-postgres"], forbiddenKinds: ["e2e", "build"] },
  { id: "contract-doc", impact: impact({ path: "docs/contracts/calls.md", domains: ["calls"], effects: [] }), forbiddenKinds: ["postgres", "e2e", "build"] },
  { id: "toolchain-lock", impact: impact({ path: "package-lock.json", domains: ["engineering-control"], effects: ["ENGINEERING_CONTROL", "CONFIGURATION", "RUNTIME_BUILD", "JAVASCRIPT"] }), required: ["kernel-control-unit", "kernel-unit-build"] },
  { id: "control-runner", impact: impact({ path: "scripts/engineering/proof-runner.mjs", domains: ["engineering-control"], effects: ["ENGINEERING_CONTROL", "JAVASCRIPT"] }), required: ["kernel-control-unit", "control-postgres-smoke", "control-e2e-smoke"], forbidden: ["control-postgres-matrix", "control-e2e-matrix"] },
  { id: "owner-ledger", impact: impact({ path: "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json", domains: ["engineering-control"], effects: ["OWNER_LEDGER_TRANSITION"] }), required: ["owner-ledger-invariant"], forbiddenKinds: ["postgres", "e2e", "build"], availableReceiptIds: ["calls-unit", "product-054-postgres", "call-owner-e2e", "kernel-unit-build"] },
  { id: "unknown-sensitive", impact: impact({ path: "infra/unknown-policy.yaml", domains: [], effects: ["CONFIGURATION"], writable: false }), rejected: true },
];
const legacyRegistries = () => ({ proofs: JSON.parse(git("show", "origin/main:docs/engineering/PROOFS.json")).proofs, domains: JSON.parse(git("show", "origin/main:docs/engineering/DOMAIN_MAP.json")).domains });
const legacySelection = (item, registries) => {
  const explicit = new Set(registries.domains.filter((domain) => item.impact.domains.includes(domain.id)).flatMap((domain) => domain.proofRefs ?? []));
  return registries.proofs.filter((proof) => explicit.has(proof.id) || (proof.domains ?? []).some((domain) => item.impact.domains.includes(domain)) || (proof.effects ?? []).includes("ALL_CHANGES"));
};
const planMetrics = (selected, plan, availableReceiptIds = []) => {
  const commands = selected.filter((proof) => !proof.kind.startsWith("owner-")).flatMap((proof) => compileRegisteredCommandPlan({ proof, baseSha: plan.baseSha, headSha: plan.headSha }).commands.filter((command) => command.executable !== "createdb"));
  const identities = commands.map((command) => command.duplicateIdentity);
  return { selectedProofCount: selected.length, selectedProofIds: selected.map((proof) => proof.id), expensiveSelectedCount: selected.filter((proof) => ["build", "postgres", "e2e"].includes(proof.kind)).length, executedCommandCount: commands.length, reusedProofCount: availableReceiptIds.filter((id) => (plan.reuseEligibleProofs ?? []).includes(id)).length, duplicateCommandCount: identities.length - new Set(identities).size, jestTestFileExecutionCount: selected.filter((proof) => proof.runner === "jest").flatMap((proof) => proof.paths).length, postgresRunnerCount: selected.filter((proof) => proof.kind === "postgres").length, e2eDirectoryCount: selected.filter((proof) => proof.kind === "e2e").flatMap((proof) => proof.paths).length, buildCount: selected.filter((proof) => proof.kind === "build").length };
};

export const runBenchmark = () => {
  const coldStarted = performance.now(), index = buildSourceIndex(), coldPacketMs = Math.round(performance.now() - coldStarted), warmStarted = performance.now(), warmIndex = buildSourceIndex(), warmPacketMs = Math.round(performance.now() - warmStarted);
  const cases = readJson("docs/engineering/BENCHMARK_TASKS.json").cases, results = []; let normal = 0, top3 = 0, top7 = 0, caller = 0, relatedTest = 0, authority = 0, falseUnknown = 0, dangerousWriteMisses = 0, graphifyQueryCount = 0;
  for (const item of cases) {
    if (item.expected === "DANGEROUS_WRITE") { const denied = classifyCommand(item.task).classification === CommandClass.PROHIBITED; if (!denied) dangerousWriteMisses += 1; results.push({ id: item.id, denied }); continue; }
    const pack = resolveContext({ task: item.task, index: warmIndex, graphify: false }); graphifyQueryCount += pack.graphifyEvidence.status === "GRAPHIFY_QUERIED" ? 1 : 0;
    const paths = pack.candidatePaths.map((candidate) => candidate.path), normalCase = Array.isArray(item.domains);
    if (!normalCase) { results.push({ id: item.id, status: pack.status }); continue; }
    normal += 1; const primary3 = paths.slice(0, 3).some((path) => matches(path, item.primary)), primary7 = paths.some((path) => matches(path, item.primary)), callerHit = pack.candidatePaths.some((candidate) => candidate.domainRoles?.some((role) => ["CALLER", "READER", "WRITER_CANDIDATE"].includes(role))), testHit = paths.some((path) => matches(path, item.tests)) || pack.candidatePaths.some((candidate) => candidate.role === "test"), authorityHit = item.domains.every((domain) => pack.domains.includes(domain));
    top3 += primary3; top7 += primary7; caller += callerHit; relatedTest += testHit; authority += authorityHit; if (pack.status !== "RESOLVED") falseUnknown += 1; results.push({ id: item.id, status: pack.status, candidateCount: paths.length, primary3, primary7, callerHit, testHit, authorityHit });
  }
  const currentProofs = readJson("docs/engineering/PROOFS.json").proofs, legacy = legacyRegistries(), economy = economyCases.map((item) => {
    if (item.rejected) { let rejected = false; try { compileProofPlan({ impact: item.impact }); } catch { rejected = true; } return { id: item.id, rejected, pass: rejected }; }
    const plan = compileProofPlan({ impact: item.impact }), selected = plan.requiredProofs.map((id) => currentProofs.find((proof) => proof.id === id)), beforeSelected = legacySelection(item, legacy), before = planMetrics(beforeSelected, item.impact), after = planMetrics(selected, plan, item.availableReceiptIds);
    const pass = (item.required ?? []).every((id) => plan.requiredProofs.includes(id)) && (item.forbidden ?? []).every((id) => !plan.requiredProofs.includes(id)) && (item.forbiddenKinds ?? []).every((kind) => !(plan.requiredByKind[kind] ?? []).length) && after.duplicateCommandCount === 0;
    return { id: item.id, before, after, pass };
  });
  const metrics = { top3PrimaryPathRecall: percentage(top3, normal), top7PrimaryPathRecall: percentage(top7, normal), callerReaderRecall: percentage(caller, normal), relatedTestRecall: percentage(relatedTest, normal), authorityRecall: percentage(authority, normal), falseUnknownAmbiguity: falseUnknown, dangerousWriteMisses, coldPacketMs, warmPacketMs, initialCandidates: Math.max(...results.map((item) => item.candidateCount ?? 0)), graphifyQueryCount, proofEconomyCases: economy.length, proofEconomyFailures: economy.filter((item) => !item.pass).length };
  const checks = { authorityRecall: metrics.authorityRecall === 100, dangerousWriteMisses: metrics.dangerousWriteMisses === 0, graphifyQueryBound: metrics.graphifyQueryCount <= cases.length, proofEconomy: metrics.proofEconomyFailures === 0 };
  return { schemaVersion: 2, metrics, checks, pass: Object.values(checks).every(Boolean), index: { fileCount: index.files.length, symbolCount: index.files.reduce((count, file) => count + file.symbols.length, 0), edgeCount: index.edges.length }, results, economy };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) { const result = runBenchmark(), args = parseArgs(); console.log(JSON.stringify({ mode: args.value("--mode", "candidate"), ...result }, null, 2)); if (!result.pass) process.exitCode = 2; }
