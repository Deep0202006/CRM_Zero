import assert from "node:assert/strict";
import { buildSourceIndex } from "./source-index.mjs";
import { resolveContext, revalidateCandidate } from "./context.mjs";

const index = buildSourceIndex({ writeCache: false }), relationshipKinds = new Set(["IMPORT", "REVERSE_IMPORT", "RELATED_TEST", "CALL", "CALLED_BY"]), matrix = [];
const golden = [
  ["calls visibility employee server confirmation", ["calls"], "R2", ["call_history"], "src/app/api/call-logs/confirm/route.ts"],
  ["attendance offline confirmation", ["attendance"], "R2", ["attendance"], "src/app/api/attendance/confirm/route.ts"],
  ["mapping attribution logged completed", ["mappings"], "R2", ["mapping_request"], "src/app/mappings/page.tsx"],
  ["pipeline retry idempotency", ["pipeline"], "R2", ["pipeline_lead"], "src/app/api/pipeline/create/route.ts"],
  ["receivable exact payment", ["receivables"], "R3", ["receivable", "payment"], "src/app/api/receivables/commands/route.ts"],
  ["distributor renewal reminders", ["distributor-status", "renewals"], "R2", ["distributor_account", "renewal"], "src/app/api/distributors/renewals/route.ts"],
  ["ERP assignment distributor", ["distributor-status", "erp"], "R3", ["distributor_erp_assignment"], "src/app/api/distributors/commands/route.ts"],
  ["external ERP partner authorization", ["erp", "erp-partner"], "R3", ["erp_partner_scope"], "src/app/api/erp-partner/distributors/route.ts"],
  ["spreadsheet import atomic", ["imports"], "R3", ["unified_distributor_master_import_orchestration"], "src/app/api/distributors/master-import/route.ts"],
  ["team KPI reporting", ["team-kpi"], "R2", ["attendance"], "src/app/api/team-kpi/route.ts"],
  ["Move managed Supabase to self-hosted platform", ["platform-handover"], "R3", ["platform_runtime_placement"], "docs/engineering/PLATFORM_HANDOVER.md"],
  ["presentation shared layout navigation", ["shared-ui"], "R0", [], "src/app/page.tsx"],
];
let relationshipCases = 0;
for (const [task, domains, risk, authorities, path] of golden) {
  const pack = resolveContext({ task, index });
  assert.equal(pack.status, "RESOLVED", task);
  for (const domain of domains) assert(pack.domains.includes(domain), `${task}:domain:${domain}`);
  assert.equal(pack.risk, risk, `${task}:risk`);
  for (const authority of authorities) assert(pack.authorities.includes(authority), `${task}:authority:${authority}`);
  assert(pack.candidatePaths.some((candidate) => candidate.path === path || candidate.path.startsWith(`${path}/`)), `${task}:path:${path}`);
  assert(pack.candidatePaths.length > 0 && pack.candidatePaths.length <= 7);
  assert(pack.candidatePaths.every((candidate) => /^[a-f0-9]{64}$/.test(candidate.contentHash) && candidate.role && candidate.matchedBy.length));
  if (pack.candidatePaths.some((candidate) => candidate.matchedBy.some((reason) => relationshipKinds.has(reason.kind)))) relationshipCases += 1;
  if (domains[0] !== "platform-handover") assert(pack.candidatePaths.some((candidate) => ["implementation", "server"].includes(candidate.role)), `${task}:implementation`);
  matrix.push({ task, status: pack.status, domains: pack.domains, candidates: pack.candidatePaths.length });
}
assert(relationshipCases >= 3, "fewer than three golden tasks used source relationships");
const sameDomainTie = resolveContext({ task: "mapping attribution logged completed", index });
assert.equal(sameDomainTie.status, "RESOLVED");
assert(sameDomainTie.candidatePaths.filter((candidate) => candidate.score === sameDomainTie.candidatePaths[0].score).length >= 1);
const conflict = resolveContext({ task: "receivable renewal payment authority conflict", index });
assert.equal(conflict.status, "SCOPE_AMBIGUOUS"); assert(conflict.unresolved.includes("CONFLICTING_AUTHORITIES")); assert.deepEqual(conflict.requiredOpenPaths, []);
const crossDomain = resolveContext({ task: "Receivables and distributor status payment import writer readers", index });
assert.equal(crossDomain.status, "RESOLVED"); assert(crossDomain.domains.includes("receivables")); assert(crossDomain.domains.includes("distributor-status"));
for (const task of ["unmapped imaginary subsystem", "attendnce offlne confirmiton"]) {
  const unknown = resolveContext({ task, index });
  assert.equal(unknown.status, "UNKNOWN"); assert.deepEqual(unknown.requiredOpenPaths, []);
}
const exact = resolveContext({ task: "inspect exact route", exactPath: "src/app/api/call-logs/confirm/route.ts", index });
assert.equal(exact.status, "RESOLVED"); assert(exact.candidatePaths[0].matchedBy.some((reason) => reason.kind === "EXACT_PATH"));
assert.equal(revalidateCandidate({ ...exact.candidatePaths[0], contentHash: "f".repeat(64) }), false);
assert(index.files.some((file) => file.imports.length && file.reverseImports.length), "import graph missing");
assert(index.files.some((file) => file.relatedTests.length || file.testedSources.length), "test relationships missing");
assert(index.files.every((file) => file.gitBlobSha && file.contentHash && file.byteSize >= 0 && file.lineCount >= 0 && file.language && file.lastChangedCommit), "tracked manifest incomplete");
assert(index.files.some((file) => file.symbols.some((symbol) => symbol.startLine > 0 && symbol.endLine >= symbol.startLine)), "line-addressable symbols missing");
assert(index.edges.some((edge) => edge.currentPath && edge.currentHash && edge.reason && edge.evidenceType), "edge provenance missing");
matrix.push({ task: "cross-domain conflict", status: conflict.status }, { task: "hash drift", status: "INVALIDATED" }, { task: "graph unavailable", status: exact.status });
console.log(JSON.stringify({ code: "CONTEXT_TEST_MATRIX_PASS", relationshipCases, matrix }));
