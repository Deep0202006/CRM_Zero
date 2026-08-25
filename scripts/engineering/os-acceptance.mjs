import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { dirtyFingerprint as repositoryDirtyFingerprint } from "./hooks/state.mjs";
const root = resolve(import.meta.dirname, "../.."),
  git = (...a) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim(),
  hash = (v) => createHash("sha256").update(String(v)).digest("hex"),
  raw = readFileSync(resolve(root, "docs/engineering/OS_V3_ACCEPTANCE.json")),
  contract = JSON.parse(raw),
  lock = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/OS_V3_ACCEPTANCE.lock.json")),
  ),
  acceptanceHash = hash(raw.toString("utf8").replace(/\r\n/g, "\n")),
  mode = process.argv[process.argv.indexOf("--mode") + 1] ?? "stop",
  base = process.env.ZEROGRAPH_BASE_SHA ?? "origin/main",
  head = process.env.ZEROGRAPH_HEAD_SHA ?? "HEAD";
if (acceptanceHash !== lock.acceptanceSha256)
  throw Error("OS_ACCEPTANCE_LOCK_INVALID");
const probe = (probeId, status, detailsCode, evidence) => ({
  probeId,
  status,
  evidenceHash: hash(evidence),
  detailsCode,
});
const hooks = JSON.parse(readFileSync(resolve(root, ".codex/hooks.json"))),
  impact = JSON.parse(
    execFileSync(
      "node",
      ["scripts/engineering/impact.mjs", "--base", base, "--head", head],
      { cwd: root, encoding: "utf8" },
    ),
  ),
  proofs = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/PROOFS.json")),
  ).proofs,
  context = spawnSync(
    "node",
    [
      "scripts/engineering/context.mjs",
      "--task",
      "show which employee completed mapping",
    ],
    { cwd: root, encoding: "utf8" },
  );
let contextPack = {};
try {
  contextPack = JSON.parse(context.stdout);
} catch {}
const hookShape = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
].every(
  (e) =>
    Array.isArray(hooks.hooks?.[e]) &&
    hooks.hooks[e].every(
      (g) =>
        Array.isArray(g.hooks) &&
        g.hooks.every(
          (h) =>
            h.type === "command" &&
            h.command &&
            h.commandWindows &&
            h.timeout > 0,
        ),
    ),
);
const preSource = readFileSync(
  resolve(root, "scripts/engineering/hooks/pre-tool.mjs"),
  "utf8",
);
const semanticRun = spawnSync(
  "node",
  ["scripts/engineering/semantic-graph.mjs"],
  { cwd: root, encoding: "utf8" },
);
let semantic = {};
try {
  semantic = JSON.parse(
    readFileSync(
      resolve(
        root,
        git("rev-parse", "--git-path", "zerograph/cache/semantic-graph.json"),
      ),
    ),
  );
} catch {}
const nodeKinds = new Set((semantic.nodes ?? []).map((n) => n.kind)),
  edgeKinds = new Set((semantic.edges ?? []).map((e) => e.kind)),
  graphKinds =
    [
      "DOMAIN",
      "AUTHORITY",
      "CAPABILITY",
      "PATH",
      "CONTRACT",
      "TEST",
      "PROOF",
      "LESSON",
      "CLAIM",
    ].every((k) => nodeKinds.has(k)) &&
    [
      "OWNS",
      "USES",
      "TESTED_BY",
      "PROVED_BY",
      "MUST_NOT_WRITE",
      "PRESERVES_CLAIM",
    ].every((k) => edgeKinds.has(k));
const graphFresh = Object.entries(semantic.manifest ?? {}).every(
  ([file, digest]) => hash(readFileSync(resolve(root, file))) === digest,
);
const domainMap = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/DOMAIN_MAP.json")),
  ).domains,
  proofPathsValid = proofs.every(
    (p) =>
      (p.paths ?? []).length &&
      (p.paths ?? []).every((path) => {
        try {
          return (
            statSync(resolve(root, path)).isFile() ||
            statSync(resolve(root, path)).isDirectory()
          );
        } catch {
          return false;
        }
      }),
  ),
  coveredDomains = domainMap
    .filter((d) => ["R2", "R3"].includes(d.riskFloor))
    .every(
      (d) =>
        proofs.some((p) => (p.domains ?? []).includes(d.id)) ||
        (d.requiredProofKinds ?? []).includes("handover"),
    ),
  controlProofs = proofs.filter((p) => p.controlPlaneCoverage === true),
  controlIsolated =
    controlProofs.length >= 3 &&
    controlProofs.every(
      (p) =>
        (p.domains ?? []).length === 1 &&
        p.domains[0] === "engineering-control",
    ) &&
    !controlProofs.some((p) => (p.domains ?? []).includes("mappings")),
  controlPlanRun = spawnSync(
    "node",
    ["scripts/engineering/proof-plan.mjs", "--base", "HEAD", "--head", "HEAD"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ZEROGRAPH_IMPACT_PATHS: '["scripts/engineering/fixture.mjs"]',
      },
    },
  ),
  controlPlan =
    controlPlanRun.status === 0 ? JSON.parse(controlPlanRun.stdout) : {},
  controlSelectionValid = [
    ...(controlPlan.unitProofs ?? []),
    ...(controlPlan.postgresProofs ?? []),
    ...(controlPlan.e2eProofs ?? []),
  ].every(
    (proof) =>
      proof.controlPlaneCoverage === true &&
      !(proof.domains ?? []).includes("mappings"),
  ),
  handoverMissing = spawnSync(
    "node",
    ["scripts/engineering/proof-plan.mjs", "--base", "HEAD", "--head", "HEAD"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ZEROGRAPH_IMPACT_PATHS: '["docs/handover/fixture.md"]',
        ZEROGRAPH_PROOFS_JSON: JSON.stringify({
          schemaVersion: 2,
          proofs: proofs.filter((proof) => proof.kind !== "handover"),
        }),
      },
    },
  ),
  handoverFailClosed =
    handoverMissing.status !== 0 &&
    `${handoverMissing.stdout}${handoverMissing.stderr}`.includes(
      "HANDOVER_PROOF_UNMAPPED",
    );
const affectedRun = spawnSync(
  "node",
  [
    "scripts/engineering/verify-affected.mjs",
    "--kind",
    "unit",
    "--base",
    base,
    "--head",
    head,
  ],
  { cwd: root, encoding: "utf8" },
);
let affected = {};
try {
  affected = JSON.parse(affectedRun.stdout);
} catch {}
const affectedValid =
  affectedRun.status === 0 &&
  affected.headSha &&
  affected.treeSha &&
  affected.planHash &&
  affected.results?.every((p) => p.status === "PLANNED");
const workflow = readFileSync(
    resolve(root, ".github/workflows/product-verification.yml"),
    "utf8",
  ),
  checkoutCount = (workflow.match(/uses: actions\/checkout@/g) ?? []).length,
  exactRefCount = (
    workflow.match(
      /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/g,
    ) ?? []
  ).length,
  exactHeadValid =
    checkoutCount > 0 &&
    checkoutCount === exactRefCount &&
    !/refs\/pull\/.*\/merge/.test(workflow) &&
    workflow.includes("Require exact PR head");
let legacy = {};
try {
  legacy = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/LEGACY_KNOWLEDGE.json")),
  );
} catch {}
const legacyFresh =
  mode === "stop" ||
  spawnSync("node", ["scripts/engineering/legacy-ingest.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  }).status === 0;
const allowedClassifications = new Set([
    "KNOWLEDGE_USED",
    "DUPLICATE",
    "OBSOLETE",
    "GENERIC_TOOLING",
    "NON_KNOWLEDGE",
    "SENSITIVE_SKIPPED",
    "SUPPORTING_EVIDENCE",
  ]),
  legacyValid =
    legacy.generatedFrom ===
      "git rev-list --objects --all + targeted filesystem scan" &&
    legacy.summary?.ledgerVersionCount >= 20 &&
    legacy.summary?.uniqueNormalizedRules >= 29 &&
    legacy.summary?.filesystemGovernanceSources > 0 &&
    legacy.summary?.parserFamilies?.length >= 10 &&
    legacy.summary?.knowledgeUsedWithoutSemantics === 0 &&
    legacy.sources?.length > 0 &&
    legacyFresh &&
    legacy.sources.every((s) => allowedClassifications.has(s.classification)) &&
    legacy.sources.every(
      (s) =>
        s.classification !== "KNOWLEDGE_USED" || s.extractedRecordCount > 0,
    ) &&
    new Set(legacy.sourceHashes ?? []).size ===
      (legacy.sourceHashes ?? []).length;
const legacyClaims = spawnSync(
  "node",
  ["scripts/quality/legacy-coverage-check.mjs"],
  { cwd: root, encoding: "utf8" },
);
const unresolvedFixture = spawnSync(
    "node",
    [
      "scripts/engineering/legacy-reconcile.mjs",
      "--text",
      "purple semaphore bananas",
    ],
    { cwd: root, encoding: "utf8" },
  ),
  independentFixture = spawnSync(
    "node",
    [
      "scripts/engineering/legacy-reconcile.mjs",
      "--text",
      "external user is not an employee and cannot enter employee work queues",
    ],
    { cwd: root, encoding: "utf8" },
  ),
  legacyIndependent =
    JSON.parse(unresolvedFixture.stdout).status === "UNRESOLVED" &&
    JSON.parse(independentFixture.stdout).preservedClaims.includes(
      "EXTERNAL_IDENTITY_NOT_EMPLOYEE",
    );
const golden = spawnSync("node", ["scripts/engineering/engineering-eval.mjs"], {
    cwd: root,
    encoding: "utf8",
  }),
  learnKnown = spawnSync(
    "node",
    [
      "scripts/engineering/learn-close.mjs",
      "--session",
      "acceptance-known",
      "--failure",
      "authorization server enforcement gap",
    ],
    { cwd: root, encoding: "utf8" },
  ),
  learnNovel = spawnSync(
    "node",
    [
      "scripts/engineering/learn-close.mjs",
      "--session",
      "acceptance-novel",
      "--failure",
      "productionizable semaphore anomaly",
    ],
    { cwd: root, encoding: "utf8" },
  ),
  learnNoise = spawnSync(
    "node",
    [
      "scripts/engineering/learn-close.mjs",
      "--session",
      "acceptance-noise",
      "--failure",
      "typo",
    ],
    { cwd: root, encoding: "utf8" },
  );
const learnValid =
  learnKnown.stdout.includes("KNOWN_RULE_ENFORCEMENT_GAP") &&
  learnNovel.stdout.includes("NOVEL_LESSON_REQUIRED") &&
  learnNoise.stdout.includes("NON_REUSABLE_FAILURE");
let goldenResult = {};
try {
  goldenResult = JSON.parse(golden.stdout);
} catch {}
const playwright = readFileSync(resolve(root, "playwright.config.ts"), "utf8"),
  healingScan = spawnSync(
    "git",
    [
      "grep",
      "-n",
      "-E",
      "updateSnapshot|--update-snapshot|writeFileSync.*(__tests__|e2e)",
      "--",
      "scripts/engineering",
      ":(exclude)scripts/engineering/os-acceptance.mjs",
    ],
    { cwd: root, encoding: "utf8" },
  ),
  selfHealingValid =
    playwright.includes("failOnFlakyTests") &&
    playwright.includes("retries: process.env.CI ? 1 : 0") &&
    healingScan.status === 1;
const evidenceRuns = [
    [1, 0, "HEAD_REGRESSION"],
    [1, 1, "BASELINE_FAILURE"],
    [0, 1, "PASS"],
  ].map(([h, b]) =>
    spawnSync(
      "node",
      [
        "scripts/engineering/repository-evidence.mjs",
        "--head-status",
        String(h),
        "--base-status",
        String(b),
      ],
      { cwd: root, encoding: "utf8" },
    ),
  ),
  repositoryValid = evidenceRuns.every(
    (run, index) =>
      run.status === 0 &&
      run.stdout.includes(
        ["HEAD_REGRESSION", "BASELINE_FAILURE", "PASS"][index],
      ) &&
      JSON.parse(run.stdout).dirtyFingerprint,
  );
const tokenValid =
    goldenResult.tokenMetrics?.max <= 900 &&
    contextPack.candidatePaths?.length <= 5 &&
    !context.stdout.includes("show which employee completed mapping") &&
    contextPack.criticalClaims?.length > 0,
  migrations = JSON.parse(
    readFileSync(
      resolve(root, "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json"),
    ),
  ),
  ownerValid =
    migrations.lastAppliedOwnerMigration === migrations.immutableThrough &&
    migrations.immutableThrough === 51 &&
    preSource.includes("immutableThrough") &&
    preSource.includes("APPLIED_OWNER_MIGRATIONS.json") &&
    preSource.includes("matchAll") &&
    workflow.includes("postgres:17"),
  tracked = git("ls-files").split(/\r?\n/),
  retirementValid = !tracked.some(
    (path) =>
      path.startsWith(".harness/") ||
      path.startsWith(".crm-engineering/") ||
      path.startsWith("docs/os/"),
  ),
  bootstrap = spawnSync("node", ["scripts/engineering/os-bootstrap-test.mjs"], {
    cwd: root,
    encoding: "utf8",
  }),
  controlValid =
    bootstrap.status === 0 &&
    goldenResult.fail === 0 &&
    JSON.parse(
      readFileSync(
        resolve(root, "docs/engineering/ENGINEERING_GOLDEN_CASES.json"),
      ),
    ).cases.some((x) => x.id === "control-plane-regressions"),
  agents = readFileSync(resolve(root, "AGENTS.md"), "utf8"),
  agentsValid =
    agents.split(/\r?\n/).length <= 120 &&
    /Graphify/i.test(agents) &&
    /authority/i.test(agents),
  incidentIds = new Set(
    JSON.parse(
      readFileSync(
        resolve(root, "docs/engineering/ENGINEERING_GOLDEN_CASES.json"),
      ),
    ).cases.map((x) => x.id),
  ),
  incidentValid = [
    "mapping-attribution",
    "calls-visibility",
    "attendance-confirmation",
    "pipeline-retry",
    "receivables-money",
    "import-atomicity",
    "erp-filter",
    "external-partner",
    "distributor-renewal",
    "production-safety",
    "repository-proof",
    "platform-handover",
    "platform-readonly-inventory",
    "platform-storage-blocker",
    "platform-auth-blocker",
    "platform-realtime-blocker",
    "platform-cutover-blocker",
    "platform-rollback-blocker",
  ].every((id) => incidentIds.has(id));
let releaseEvidence = [],
  releaseMatrix = false;
if (mode === "release" && process.env.ZEROGRAPH_EVIDENCE_DIR) {
  try {
    releaseEvidence = [
      "preflight.json",
      "unit-build.json",
      "evidence-postgres.json",
      "evidence-e2e.json",
    ].map((file) =>
      JSON.parse(
        readFileSync(resolve(process.env.ZEROGRAPH_EVIDENCE_DIR, file)),
      ),
    );
    const currentHead = git("rev-parse", head),
      currentTree = git("rev-parse", `${head}^{tree}`),
      identity = releaseEvidence.every(
        (item) =>
          item.headSha === currentHead &&
          item.treeSha === currentTree &&
          item.planHash === affected.planHash,
      ),
      statuses = releaseEvidence.every(
        (item) =>
          item.status === "PASS" ||
          (item.results?.length > 0 &&
            item.results.every((result) => result.status === "PASS")),
      );
    releaseMatrix = identity && statuses;
  } catch {
    releaseMatrix = false;
  }
}
const results = [
  probe(
    "context-wire",
    contextPack.taskHash && contextPack.confidence && contextPack.candidatePaths
      ? "PASS"
      : "FAIL",
    "CONTEXT_WIRE_INCOMPLETE",
    context.stdout,
  ),
  probe(
    "semantic-graph-wire",
    semanticRun.status === 0 &&
      graphKinds &&
      graphFresh &&
      bootstrap.status === 0
      ? "PASS"
      : "FAIL",
    "SEMANTIC_GRAPH_INCOMPLETE",
    JSON.stringify(semantic),
  ),
  probe(
    "impact-wire",
    impact.domains?.length && impact.effects?.length && impact.risk
      ? "PASS"
      : "FAIL",
    "IMPACT_DOMAINS_REQUIRED",
    JSON.stringify(impact),
  ),
  probe(
    "proof-domain-intersection",
    coveredDomains &&
      controlIsolated &&
      controlSelectionValid &&
      handoverFailClosed &&
      proofPathsValid
      ? "PASS"
      : "FAIL",
    "PROOF_REGISTRY_DOMAIN_GAP",
    JSON.stringify({
      coveredDomains,
      controlIsolated,
      controlSelectionValid,
      handoverFailClosed,
      proofPathsValid,
      proofs,
    }),
  ),
  probe(
    "affected-executor",
    affectedValid ? "PASS" : "FAIL",
    "AFFECTED_EXECUTOR_INVALID",
    JSON.stringify(affected),
  ),
  probe(
    "exact-head",
    exactHeadValid ? "PASS" : "FAIL",
    "EXACT_HEAD_CI_INVALID",
    workflow,
  ),
  probe(
    "legacy-discovery",
    legacyValid ? "PASS" : "FAIL",
    "LEGACY_SOURCE_INCOMPLETE",
    JSON.stringify(legacy.summary ?? {}),
  ),
  probe(
    "legacy-claims",
    legacyClaims.status === 0 && legacyIndependent ? "PASS" : "FAIL",
    "LEGACY_SEMANTIC_UNRESOLVED",
    legacyClaims.stdout + legacyClaims.stderr,
  ),
  probe(
    "golden-evals",
    golden.status === 0 && goldenResult.executable === goldenResult.total
      ? "PASS"
      : "FAIL",
    "GOLDEN_EVAL_FAILED",
    golden.stdout + golden.stderr,
  ),
  probe(
    "learn-close",
    learnValid && bootstrap.status === 0 ? "PASS" : "FAIL",
    "LEARNING_CLASSIFICATION_INVALID",
    learnKnown.stdout + learnNovel.stdout + learnNoise.stdout,
  ),
  probe(
    "hooks-v2",
    hookShape &&
      bootstrap.status === 0 &&
      preSource.includes("hookSpecificOutput") &&
      !preSource.includes("console.log(JSON.stringify({permissionDecision")
      ? "PASS"
      : "FAIL",
    "HOOK_WIRE_INVALID",
    JSON.stringify(hooks) + preSource,
  ),
  probe(
    "self-healing-policy",
    selfHealingValid && bootstrap.status === 0 ? "PASS" : "FAIL",
    "SELF_HEALING_UNSAFE",
    playwright + healingScan.stdout,
  ),
  probe(
    "repository-evidence",
    repositoryValid ? "PASS" : "FAIL",
    "REPOSITORY_EVIDENCE_INVALID",
    evidenceRuns.map((x) => x.stdout).join(""),
  ),
  probe(
    "token-budget",
    tokenValid ? "PASS" : "FAIL",
    "TOKEN_BUDGET_EXCEEDED",
    JSON.stringify(goldenResult.tokenMetrics),
  ),
  probe(
    "owner-safety",
    ownerValid ? "PASS" : "FAIL",
    "OWNER_SAFETY_INVALID",
    JSON.stringify(migrations) + preSource,
  ),
  probe(
    "retirement",
    retirementValid ? "PASS" : "FAIL",
    "PARALLEL_OS_TRACKED",
    tracked.join("\n"),
  ),
  probe(
    "control-plane-fixtures",
    controlValid ? "PASS" : "FAIL",
    "CONTROL_PLANE_REGRESSION",
    bootstrap.stdout + golden.stdout,
  ),
  probe(
    "agents-map",
    agentsValid ? "PASS" : "FAIL",
    "AGENTS_MAP_NOT_LEAN",
    agents,
  ),
  probe(
    "incident-replay",
    incidentValid && golden.status === 0 ? "PASS" : "FAIL",
    "INCIDENT_REPLAY_INCOMPLETE",
    golden.stdout,
  ),
  probe(
    "release-matrix",
    mode !== "release" ? "NOT_APPLICABLE" : releaseMatrix ? "PASS" : "FAIL",
    "RELEASE_EVIDENCE_STALE",
    JSON.stringify(releaseEvidence),
  ),
];
for (const acceptance of contract.acceptances)
  for (const id of acceptance.requiredProbeIds)
    if (!results.some((p) => p.probeId === id))
      results.push(probe(id, "NOT_IMPLEMENTED", "PROBE_NOT_IMPLEMENTED", id));
const byId = new Map(results.map((p) => [p.probeId, p])),
  passed = [],
  pending = [],
  failed = [];
for (const acceptance of contract.acceptances) {
  const ps = acceptance.requiredProbeIds.map((id) => byId.get(id)),
    ok = ps.every((p) => p.status === "PASS");
  if (ok) passed.push(acceptance.id);
  else {
    pending.push(acceptance.id);
    if (ps.some((p) => p.status === "FAIL")) failed.push(acceptance.id);
  }
}
const headSha = git("rev-parse", "HEAD"),
  treeSha = git("rev-parse", "HEAD^{tree}"),
  dirtyFingerprint = repositoryDirtyFingerprint(),
  next = contract.acceptances.find((a) => pending.includes(a.id)),
  evidenceHash = hash(JSON.stringify(results)),
  releaseReady = mode === "release" && !pending.length,
  commands = {
    "context-wire": "npm run context:test",
    "semantic-graph-wire": "npm run semantic:graph",
    "impact-wire": "npm run impact:compile",
    "proof-domain-intersection": "npm run proof:plan",
    "affected-executor": "npm run verify:affected",
    "legacy-discovery": "npm run legacy:ingest",
    "legacy-claims": "npm run legacy:reconcile && npm run quality:legacy",
    "golden-evals": "npm run engineering:eval",
    "learn-close": "npm run learn:close",
    "hooks-v2": "npm run os:bootstrap-test",
    "self-healing-policy": "npm run quality:invariants",
    "repository-evidence": "node scripts/engineering/repository-evidence.mjs",
    "token-budget": "npm run engineering:eval",
    "owner-safety": "npm run quality:knowledge",
    retirement: "npm run quality:knowledge",
    "control-plane-fixtures": "npm run os:bootstrap-test",
    "agents-map": "npm run quality:knowledge",
    "incident-replay": "npm run engineering:eval",
    "exact-head": "npm run quality:release",
    "release-matrix": "gh pr checks 84 --watch",
  },
  output = {
    schemaVersion: 2,
    acceptanceHash,
    headSha,
    treeSha,
    dirtyFingerprint,
    localComplete: !contract.acceptances
      .filter((a) => a.phase === "implementation")
      .some((a) => pending.includes(a.id)),
    releaseReady,
    passed,
    pending,
    failed,
    nextAction: next
      ? {
          acceptanceId: next.id,
          probeIds: next.requiredProbeIds,
          command: commands[next.requiredProbeIds[0]],
          reason: next.failureCode,
        }
      : null,
    evidenceHash,
    progressSignature: hash(
      JSON.stringify({
        headSha,
        treeSha,
        dirtyFingerprint,
        evidenceHash,
        pending,
      }),
    ),
  };
console.log(JSON.stringify(output));
if (mode === "preflight" && !output.localComplete) process.exit(2);
if (mode === "release" && !output.releaseReady) process.exit(2);
