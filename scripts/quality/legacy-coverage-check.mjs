import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  json = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8")),
  coverage = json("docs/engineering/LEGACY_COVERAGE.json"),
  knowledge = json("docs/engineering/LEGACY_KNOWLEDGE.json"),
  lessons = json("docs/engineering/LESSONS.json").lessons,
  claims = json("docs/engineering/CLAIMS.json").claims,
  byLesson = new Map(lessons.map((x) => [x.id, x])),
  byClaim = new Map(claims.map((x) => [x.id, x])),
  records = new Set(knowledge.records.map((x) => x.ruleTextHash)),
  fail = (message) => {
    console.error(`legacy: ${message}`);
    process.exitCode = 1;
  };
try { execFileSync("node", ["scripts/engineering/legacy-ingest.mjs", "--check"], { cwd: root, stdio: "pipe" }); } catch { fail("frozen corpus drift"); }
if (coverage.schemaVersion !== 4) fail("coverage schemaVersion must be 4");
if (knowledge.schemaVersion !== 2)
  fail("legacy knowledge schemaVersion must be 2");
for (const source of knowledge.sources ?? [])
  if (
    source.classification === "KNOWLEDGE_USED" &&
    !(source.extractedRecordCount > 0)
  )
    fail(`knowledge source has no extracted semantics: ${source.path}`);
for (const item of coverage.resolutions ?? []) {
  if (!records.has(item.ruleTextHash))
    fail(`unknown legacy record: ${item.ruleTextHash}`);
  if (
    !["EXACT", "CONSOLIDATED", "OBSOLETE", "UNRESOLVED"].includes(item.status)
  )
    fail(`invalid status: ${item.legacyId}`);
  if (item.status === "UNRESOLVED")
    fail(`legacy semantic unresolved: ${item.legacyId}`);
  if (
    item.status === "OBSOLETE" &&
    (!item.reason || !(item.enforcementRefs ?? []).length)
  )
    fail(`obsolete evidence missing: ${item.legacyId}`);
  if (["EXACT", "CONSOLIDATED"].includes(item.status)) {
    if (!(item.preservedClaims ?? []).length)
      fail(`independent claims missing: ${item.legacyId}`);
    for (const claim of item.preservedClaims ?? [])
      if (!byClaim.has(claim))
        fail(`unknown preserved claim: ${item.legacyId}/${claim}`);
    const targets = (item.targets ?? []).map((id) => byLesson.get(id));
    if (!targets.length || targets.some((x) => !x)) {
      fail(`target missing: ${item.legacyId}`);
      continue;
    }
    const targetClaims = new Set(targets.flatMap((x) => x.claims ?? []));
    for (const claim of item.preservedClaims ?? [])
      if (!targetClaims.has(claim))
        fail(`claim not preserved by lesson: ${item.legacyId}/${claim}`);
    for (const ref of item.enforcementRefs ?? [])
      if (!existsSync(resolve(root, ref)))
        fail(`missing enforcement: ${item.legacyId}/${ref}`);
  }
}
const expected = {
  SERVER_SCOPE_NOT_UI_FILTER_RULE: [
    "AUTHZ_SERVER_ENFORCED",
    "UI_FILTER_NOT_AUTHORIZATION",
  ],
  EXTERNAL_ACCOUNT_NOT_EMPLOYEE_RULE: ["EXTERNAL_IDENTITY_NOT_EMPLOYEE"],
  EXTERNAL_VIEW_DATA_MINIMIZATION_RULE: ["EXTERNAL_DATA_MINIMIZATION"],
  DERIVED_FINANCIAL_STATE_RULE: ["FINANCIAL_STATE_DERIVED"],
};
for (const [id, want] of Object.entries(expected)) {
  const found = coverage.resolutions.find((x) => x.legacyId === id);
  if (!found || want.some((claim) => !found.preservedClaims?.includes(claim)))
    fail(`known semantic mapping wrong: ${id}`);
}
const mechanismCanaries = [
  "NO_END_WITH_INCOMPLETE_ACCEPTANCE",
  "INCOMPLETE_WORK_IS_NOT_EXTERNAL_BLOCKER",
  "IMPLEMENT_BEFORE_BROAD_VERIFY",
  "STALL_RETRY_THEN_STRATEGY_CHANGE",
  "TASK_BASE_AND_DIRTY_BASELINE_KNOWN",
  "CONTENT_SENSITIVE_WORKTREE",
  "EXACT_HEAD_PROOF",
  "FRESH_PROOF_REUSE",
  "OWNER_PRODUCTION_HUMAN_GATE",
  "OWNER_POSTCHECK_REQUIRED",
  "NO_REDUNDANT_LOCAL_TOOLCHAIN",
  "BASELINE_FAILURE_ABLATION",
  "WORKER_RESULT_SCHEMA_VALIDATION",
  "ACCEPTANCE_EVIDENCE_BINDING",
  "STATUS_PORTABILITY",
  "NO_PRODUCTION_DUMMY_DATA",
  "APPLIED_MIGRATION_IMMUTABLE",
];
for (const claim of mechanismCanaries) {
  if (!(byClaim.get(claim)?.evalRefs ?? []).length)
    fail(`historical mechanism has no eval: ${claim}`);
  if (
    !coverage.resolutions.some((item) => item.preservedClaims?.includes(claim))
  )
    fail(`historical mechanism not independently reconciled: ${claim}`);
}
if (!process.exitCode)
  console.log(
    `Legacy semantic coverage passed (${coverage.resolutions.length} rules; 0 unresolved; independent claims verified).`,
  );
