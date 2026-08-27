import assert from "node:assert/strict";
import { buildSourceIndex } from "./source-index.mjs";
import { resolveContext, revalidateCandidate } from "./context.mjs";
const index = buildSourceIndex({ writeCache: false });
const matrix = [];
for (const [task, domain, path] of [
  ["MappingsPage should show who logged and completed each mapping", "mappings", "src/app/mappings/page.tsx"],
  ["loadCallHistoryWithOptionalMetrics loses calls for employee", "calls", "src/app/api/call-logs/history/route.ts"],
  ["execute_receivable_command_v1 must target the exact receivable", "receivables", "src/app/api/receivables/commands/route.ts"],
  ["Move managed Supabase to self-hosted platform", "platform-handover", "docs/engineering/PLATFORM_HANDOVER.md"],
]) {
  const pack = resolveContext({ task, index });
  assert.equal(pack.status, "RESOLVED", task);
  assert(pack.domains.includes(domain), `${task}:${domain}`);
  assert(pack.candidatePaths.some((candidate) => candidate.path === path || candidate.path.startsWith(`${path}/`)), `${task}:${path}`);
  assert(pack.candidatePaths.length <= 7);
  matrix.push({ case: domain, status: pack.status });
}
const partner = resolveContext({ task: "erp-partner erp_partner_distributors_v1", index });
assert.equal(partner.status, "RESOLVED");
assert(partner.domains.includes("erp-partner"));
const conflict = resolveContext({ task: "calls receivable", index });
assert.equal(conflict.status, "SCOPE_AMBIGUOUS");
assert(conflict.unresolved.includes("CONFLICTING_AUTHORITIES"));
const lexical = resolveContext({ task: "mapping", index: { files: [{ path: "tools/mapping.ts", contentHash: "0".repeat(64), exports: [], imports: [], tables: [], rpcs: [], routes: [], sqlIdentifiers: [], reverseImports: [] }] } });
assert.equal(lexical.status, "SCOPE_AMBIGUOUS");
assert.deepEqual(lexical.requiredOpenPaths, []);
const lowMargin = resolveContext({ task: "Mapping should show who logged and completed each mapping", index });
assert.equal(lowMargin.status, "SCOPE_AMBIGUOUS"); assert(lowMargin.unresolved.includes("LOW_MARGIN"));
const exact = resolveContext({ task: "inspect exact route", exactPath: "src/app/api/call-logs/confirm/route.ts", index });
assert.equal(exact.status, "RESOLVED");
assert.equal(exact.candidatePaths[0].matchedBy[0].kind, "exact-identifier");
assert.equal(revalidateCandidate({ ...exact.candidatePaths[0], contentHash: "f".repeat(64) }), false);
const unknown = resolveContext({ task: "unmapped imaginary subsystem", index });
assert.equal(unknown.status, "UNKNOWN");
assert(index.files.some((file) => file.tables.length || file.rpcs.length), "compiler index did not extract database targets");
matrix.push({ case: "conflicting-authority", status: conflict.status }, { case: "lexical-only", status: lexical.status }, { case: "low-margin", status: lowMargin.status }, { case: "hash-drift", status: "INVALIDATED" }, { case: "graph-unavailable-fallback", status: exact.status });
console.log(JSON.stringify({ code: "CONTEXT_TEST_MATRIX_PASS", matrix }));
