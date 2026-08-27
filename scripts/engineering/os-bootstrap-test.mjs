import { spawnSync, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { resolveProofPath } from "./proof-path.mjs";
const root = resolve(import.meta.dirname, "../.."),
  operationalSessionRoot = resolve(
    root,
    execFileSync("git", ["rev-parse", "--git-path", "zerograph/sessions"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
  ),
  sessionSnapshot = () => {
    if (!existsSync(operationalSessionRoot)) return { exists: false, files: [] };
    const files = [];
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) {
          const content = readFileSync(path);
          files.push({
            path: relative(operationalSessionRoot, path).replaceAll("\\", "/"),
            size: statSync(path).size,
            sha256: createHash("sha256").update(content).digest("hex"),
          });
        }
      }
    };
    walk(operationalSessionRoot);
    return { exists: true, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  },
  operationalSessionBefore = sessionSnapshot(),
  hookFixtureRoot = mkdtempSync(resolve(tmpdir(), "zerograph-hook-git-"));
let operationalSessionAfter, isolatedGreenClosureProof = false;
try {
  const exactRepositoryHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  execFileSync("git", ["clone", "--quiet", "--no-checkout", root, hookFixtureRoot]);
  const hookGitDir = resolve(hookFixtureRoot, ".git"),
    isolatedGitEnv = { GIT_DIR: hookGitDir, GIT_WORK_TREE: root },
    fixtureGit = (args, options = {}) =>
      execFileSync("git", args, {
        ...options,
        cwd: root,
        encoding: options.encoding ?? "utf8",
        env: { ...process.env, ...(options.env ?? {}), ...isolatedGitEnv },
      });
  fixtureGit(["update-ref", "--no-deref", "HEAD", exactRepositoryHead]);
  fixtureGit(["read-tree", "HEAD"]);
  if (fixtureGit(["rev-parse", "HEAD"]).trim() !== exactRepositoryHead)
    throw Error("ISOLATED_HOOK_FIXTURE_HEAD_MISMATCH");
  const acceptanceFixture = JSON.stringify({
      localComplete: false,
      progressSignature: "fixture-progress",
      evidenceHash: "fixture-evidence",
      nextAction: { acceptanceId: "ZOS-A01", command: "npm run context:test" },
    }),
  run = (path, input) =>
    spawnSync("node", [resolve(root, path)], {
      cwd: resolve(root, "src"),
      input: JSON.stringify(input ?? {}),
      encoding: "utf8",
      env: {
        ...process.env,
        ZEROGRAPH_ACCEPTANCE_FIXTURE: acceptanceFixture,
        ...isolatedGitEnv,
      },
    }),
  runWithEnv = (path, input, env) =>
    spawnSync("node", [resolve(root, path)], {
      cwd: resolve(root, "src"),
      input: JSON.stringify(input ?? {}),
      encoding: "utf8",
      env: { ...process.env, ...env, ...isolatedGitEnv },
    }),
  runStatelessWithEnv = (path, input, env) =>
    spawnSync("node", [resolve(root, path)], {
      cwd: resolve(root, "src"),
      input: JSON.stringify(input ?? {}),
      encoding: "utf8",
      env: { ...process.env, ...env },
    }),
  parse = (r) => (r.stdout.trim() ? JSON.parse(r.stdout) : null),
  assert = (ok, code) => {
    if (!ok) throw Error(code);
  };
const config = JSON.parse(readFileSync(resolve(root, ".codex/hooks.json"))),
  events = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Stop",
  ];
const acceptanceText = readFileSync(
    resolve(root, "docs/engineering/OS_V3_ACCEPTANCE.json"),
    "utf8",
  ),
  acceptanceLock = JSON.parse(
    readFileSync(
      resolve(root, "docs/engineering/OS_V3_ACCEPTANCE.lock.json"),
      "utf8",
    ),
  ),
  portableAcceptanceHash = createHash("sha256")
    .update(acceptanceText.replace(/\r\n/g, "\n"))
    .digest("hex");
assert(
  portableAcceptanceHash === acceptanceLock.acceptanceSha256,
  "ACCEPTANCE_LOCK_NOT_LINE_ENDING_PORTABLE",
);
const valid = events.every((e) =>
  config.hooks[e]?.every(
    (g) =>
      Array.isArray(g.hooks) &&
      g.hooks.every(
        (h) =>
          h.type === "command" && h.command && h.commandWindows && h.timeout,
      ),
  ),
);
assert(valid, "HOOK_CONFIG_INVALID");
assert(
  !events.every(
    (e) =>
      ({ hooks: { UserPromptSubmit: [{ command: "node old.mjs" }] } }).hooks[e],
  ),
  "FLAT_HOOK_ACCEPTED",
);
assert(
  JSON.stringify(config).includes("git rev-parse --show-toplevel"),
  "ROOT_RESOLUTION_MISSING",
);
assert(
  JSON.stringify(config).includes("commandWindows"),
  "WINDOWS_COMMAND_MISSING",
);
const denied = parse(
  run("scripts/engineering/hooks/pre-tool.mjs", {
    tool_name: "Bash",
    tool_input: { command: "git reset --hard" },
  }),
);
assert(
  denied?.hookSpecificOutput?.hookEventName === "PreToolUse" &&
    denied.hookSpecificOutput.permissionDecision === "deny" &&
    !denied.permissionDecision,
  "PRETOOL_WIRE_INVALID",
);
assert(
  run("scripts/engineering/hooks/pre-tool.mjs", {
    tool_name: "Bash",
    tool_input: { command: "git status" },
  }).stdout === "",
  "SAFE_COMMAND_OVERBLOCKED",
);
assert(
  parse(
    run("scripts/engineering/hooks/pre-tool.mjs", {
      tool_name: "Write",
      tool_input: { path: "docs/engineering/OS_V3_ACCEPTANCE.json" },
    }),
  )?.hookSpecificOutput?.permissionDecision === "deny",
  "LOCK_NOT_PROTECTED",
);
assert(
  run("scripts/engineering/hooks/pre-tool.mjs", {
    tool_name: "Bash",
    tool_input: {
      command: "git diff -- docs/engineering/OS_V3_ACCEPTANCE.json",
    },
  }).stdout === "",
  "READ_ONLY_LOCK_INSPECTION_OVERBLOCKED",
);
const session_id = `bootstrap-${randomUUID()}`,
  owner = "Owner mapping task",
  ownerOut = parse(
    run("scripts/engineering/hooks/user-prompt.mjs", {
      session_id,
      prompt: owner,
    }),
  );
assert(
  ownerOut.hookSpecificOutput.hookEventName === "UserPromptSubmit",
  "PROMPT_WIRE_INVALID",
);
const sessionFile = fixtureGit([
    "rev-parse",
    "--git-path",
    `zerograph/sessions/${session_id}.json`,
  ]).trim(),
  before = JSON.parse(readFileSync(resolve(root, sessionFile)));
run("scripts/engineering/hooks/user-prompt.mjs", {
  session_id,
  prompt: "ZEROGRAPH_CONTINUE|acceptance=ZOS-A01",
});
const after = JSON.parse(readFileSync(resolve(root, sessionFile)));
assert(
  before.originalTaskHash === after.originalTaskHash &&
    !JSON.stringify(after).includes(owner),
  "CONTINUATION_TASK_IDENTITY_LOST",
);
const other = `bootstrap-${randomUUID()}`;
run("scripts/engineering/hooks/user-prompt.mjs", {
  session_id: other,
  prompt: "Different task",
});
assert(
  sessionFile !==
    fixtureGit([
      "rev-parse",
      "--git-path",
      `zerograph/sessions/${other}.json`,
    ]).trim(),
  "SESSION_ISOLATION_FAILED",
);
const s1 = parse(
    run("scripts/engineering/hooks/stop.mjs", {
      session_id,
      stop_hook_active: false,
    }),
  ),
  s2 = parse(
    run("scripts/engineering/hooks/stop.mjs", {
      session_id,
      stop_hook_active: false,
    }),
  ),
  s3 = parse(
    run("scripts/engineering/hooks/stop.mjs", {
      session_id,
      stop_hook_active: false,
    }),
  ),
  s4 = parse(
    run("scripts/engineering/hooks/stop.mjs", {
      session_id,
      stop_hook_active: false,
    }),
  );
assert(
  s1.decision === "block" && s1.reason.startsWith("ZEROGRAPH_CONTINUE|"),
  "STOP_CONTINUATION_FAILED",
);
assert(s2.reason.includes("strategy-change"), "STOP_STRATEGY_CHANGE_FAILED");
assert(
  s3.reason.startsWith("ZEROGRAPH_STALL_REPORT|"),
  "STOP_STALL_REPORT_FAILED",
);
assert(s4.stopReason === "STALL_LIMIT", "STOP_LOOP_UNBOUNDED");
assert(
  parse(
    run("scripts/engineering/hooks/stop.mjs", {
      session_id: `active-${randomUUID()}`,
      stop_hook_active: true,
    }),
  )?.decision === "block",
  "STOP_ACTIVE_BYPASS_NOT_REMOVED",
);
const workflow = readFileSync(
    resolve(root, ".github/workflows/product-verification.yml"),
    "utf8",
  ),
  checkouts = (workflow.match(/uses: actions\/checkout@v4/g) ?? []).length,
  refs = (
    workflow.match(
      /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/g,
    ) ?? []
  ).length;
assert(checkouts === refs, "EXACT_HEAD_CHECKOUT_MISSING");
assert(
  /receivables-postgres:[\s\S]*?if: always\(\)/.test(workflow) &&
    /e2e:[\s\S]*?if: always\(\)/.test(workflow) &&
    /verify:[\s\S]*?if: always\(\)/.test(workflow),
  "CI_EVIDENCE_DEADLOCK",
);
assert(
  !/preflight:[\s\S]*?os:acceptance -- --mode release[\s\S]*?unit-build:/.test(
    workflow,
  ),
  "EARLY_RELEASE_GATE_PRESENT",
);

const greenAcceptance = JSON.stringify({
    localComplete: true,
    progressSignature: "os-green",
  }),
  unfinishedTask = JSON.stringify({
    status: "IMPLEMENTATION_INCOMPLETE",
    nextAction: "Run the missing domain proof",
  }),
  futureStop = parse(
    runWithEnv(
      "scripts/engineering/hooks/stop.mjs",
      { session_id: `future-${randomUUID()}`, stop_hook_active: false },
      {
        ZEROGRAPH_ACCEPTANCE_FIXTURE: greenAcceptance,
        ZEROGRAPH_TASK_CLOSE_FIXTURE: unfinishedTask,
      },
    ),
  );
assert(
  futureStop?.decision === "block" &&
    futureStop.reason.includes("Run the missing domain proof"),
  "FUTURE_TASK_STOP_NOT_ENFORCED",
);
const exactHead = fixtureGit(["rev-parse", "HEAD"]).trim(),
  ancestorBase = fixtureGit(["rev-parse", "HEAD^"]).trim(),
  staleBase = fixtureGit(
    ["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "stale base fixture"],
    {
      env: {
        GIT_AUTHOR_NAME: "ZeroGraph Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "ZeroGraph Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    },
  ).trim(),
  fakeGhRoot = mkdtempSync(resolve(tmpdir(), "zerograph-gh-")),
  fakeGhScript = resolve(fakeGhRoot, "gh.mjs"),
  fixturePrNumber = process.pid,
  pr = (overrides = {}) => ({
    number: fixturePrNumber,
    headRefOid: exactHead,
    baseRefOid: ancestorBase,
    baseRefName: "main",
    url: "https://example.invalid/pr/fixture",
    ...overrides,
  }),
  passChecks = [
    {
      name: "preflight",
      state: "SUCCESS",
      bucket: "pass",
      link: "https://example.invalid/check",
    },
  ],
  closeStop = (status, fixture = {}) =>
    runWithEnv(
      "scripts/engineering/hooks/stop.mjs",
      {
        session_id: fixture.sessionId ?? `fixture-remote-${randomUUID()}`,
        stop_hook_active: false,
      },
      {
        ZEROGRAPH_ACCEPTANCE_FIXTURE: greenAcceptance,
        ZEROGRAPH_TASK_CLOSE_FIXTURE: JSON.stringify({ status, nextAction: null }),
        ZEROGRAPH_FAKE_PR: fixture.pr === null ? "" : JSON.stringify(fixture.pr ?? pr()),
        ZEROGRAPH_FAKE_CHECKS:
          typeof fixture.checks === "string"
            ? fixture.checks
            : JSON.stringify(fixture.checks ?? passChecks),
        ZEROGRAPH_FAKE_PR_STATUS: String(fixture.prStatus ?? 0),
        ZEROGRAPH_FAKE_CHECK_STATUS: String(fixture.checkStatus ?? 0),
        ZEROGRAPH_FAKE_STDERR: fixture.stderr ?? "",
        ZEROGRAPH_GH_FIXTURE: fakeGhScript,
      },
    );
writeFileSync(
  fakeGhScript,
  `const checks = process.argv[3] === "checks";
process.stdout.write(checks ? process.env.ZEROGRAPH_FAKE_CHECKS : process.env.ZEROGRAPH_FAKE_PR);
process.stderr.write(process.env.ZEROGRAPH_FAKE_STDERR ?? "");
process.exit(Number(checks ? process.env.ZEROGRAPH_FAKE_CHECK_STATUS : process.env.ZEROGRAPH_FAKE_PR_STATUS));\n`,
);
try {
  const pending = parse(
      closeStop("TASK_LOCAL_COMPLETE", {
        checks: [{ ...passChecks[0], state: "PENDING", bucket: "pending" }],
        checkStatus: 8,
      }),
    ),
    failed = parse(
      closeStop("TASK_LOCAL_COMPLETE", {
        checks: [{ ...passChecks[0], state: "FAILURE", bucket: "fail" }],
        checkStatus: 1,
      }),
    );
  assert(
    pending?.decision === "block" && pending.reason.includes("REMOTE_CHECKS_PENDING"),
    "REMOTE_PENDING_PROCESS_EXIT_LOST",
  );
  assert(
    failed?.decision === "block" && failed.reason.includes("REMOTE_CHECKS_FAILED"),
    "REMOTE_FAILURE_PROCESS_EXIT_LOST",
  );
  for (const state of ["CANCELLED", "TIMED_OUT"])
    assert(
      parse(
        closeStop("TASK_LOCAL_COMPLETE", {
          checks: [{ ...passChecks[0], state, bucket: "fail" }],
          checkStatus: 1,
        }),
      )?.reason.includes("REMOTE_CHECKS_FAILED"),
      `REMOTE_${state}_NOT_BLOCKING`,
    );
  const greenSession = `fixture-remote-${randomUUID()}`,
    greenResult = closeStop("TASK_LOCAL_COMPLETE", { sessionId: greenSession }),
    isolatedGreenPath = fixtureGit([
      "rev-parse",
      "--git-path",
      `zerograph/sessions/${greenSession}.json`,
    ]).trim(),
    operationalGreenPath = resolve(
      root,
      execFileSync(
        "git",
        ["rev-parse", "--git-path", `zerograph/sessions/${greenSession}.json`],
        { cwd: root, encoding: "utf8" },
      ).trim(),
    ),
    greenState = JSON.parse(readFileSync(resolve(root, isolatedGreenPath)));
  assert(greenResult.stdout === "", "REMOTE_PASS_DID_NOT_CLOSE_LOCAL_TASK");
  assert(
    greenState.taskClosed === true &&
      greenState.remoteEvidence?.headSha === exactHead &&
      greenState.remoteEvidence?.checkNames?.includes("preflight") &&
      !existsSync(operationalGreenPath),
    "ISOLATED_GREEN_CLOSURE_EVIDENCE_INVALID",
  );
  isolatedGreenClosureProof = true;
  assert(
    parse(
      closeStop("TASK_LOCAL_COMPLETE", {
        checks: "",
        checkStatus: 1,
        stderr: "authentication required",
      }),
    )?.stopReason === "EXTERNAL_DEPENDENCY",
    "REMOTE_AUTH_FAILURE_NOT_EXTERNAL",
  );
  assert(
    parse(closeStop("TASK_LOCAL_COMPLETE", { checks: "not-json" }))?.stopReason ===
      "EXTERNAL_DEPENDENCY",
    "REMOTE_MALFORMED_JSON_NOT_EXTERNAL",
  );
  assert(
    parse(closeStop("TASK_LOCAL_COMPLETE", { pr: pr({ headRefOid: "stale" }) }))?.reason.includes(
      "HEAD_MISMATCH",
    ),
    "REMOTE_HEAD_MISMATCH_DID_NOT_BLOCK",
  );
  assert(
    closeStop("AWAITING_REMOTE_EVIDENCE").stdout === "",
    "REMOTE_PASS_DID_NOT_CLOSE_AWAITING_TASK",
  );
  assert(
    parse(closeStop("TASK_LOCAL_COMPLETE", { pr: pr({ baseRefOid: staleBase }) }))?.reason.includes(
      "STALE_BASE",
    ),
    "REMOTE_STALE_BASE_DID_NOT_BLOCK",
  );
  assert(
    parse(closeStop("TASK_LOCAL_COMPLETE", { pr: pr({ baseRefOid: undefined }) }))
      ?.stopReason === "EXTERNAL_DEPENDENCY",
    "REMOTE_MISSING_BASE_NOT_EXTERNAL",
  );
  assert(
    closeStop("TASK_LOCAL_COMPLETE", { pr: pr({ baseRefOid: ancestorBase }) }).stdout === "" &&
      parse(closeStop("TASK_LOCAL_COMPLETE", { pr: pr({ baseRefOid: staleBase }) }))?.reason.includes(
        "STALE_BASE",
      ),
    "REMOTE_CHANGED_BASE_NOT_RECHECKED",
  );
  assert(
    parse(closeStop("IMPLEMENTATION_INCOMPLETE"))?.decision === "block",
    "REMOTE_OVERRULED_INCOMPLETE_TASK",
  );
} finally {
  rmSync(fakeGhRoot, { recursive: true, force: true });
}

const legacyStatusBefore = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }),
  legacyCheck = (...args) =>
    spawnSync("node", ["scripts/engineering/legacy-ingest.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
    }),
  legacyFailure = (result, code) =>
    result.status === 2 && `${result.stdout}${result.stderr}`.includes(code),
  legacyFixtureRoot = mkdtempSync(resolve(tmpdir(), "zerograph-a07-")),
  legacyFixtureIndex = resolve(legacyFixtureRoot, "index"),
  legacyFixtureRef = "refs/remotes/origin/zerograph-a07-fixture",
  legacyGit = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_INDEX_FILE: legacyFixtureIndex,
        GIT_AUTHOR_NAME: "ZeroGraph Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "ZeroGraph Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
      ...options,
    });
const frozenNoArguments = legacyCheck(),
  frozenExplicitCheck = legacyCheck("--check");
assert(
  frozenNoArguments.status === 0 &&
    frozenExplicitCheck.status === 0 &&
    frozenNoArguments.stdout === frozenExplicitCheck.stdout &&
    JSON.parse(frozenNoArguments.stdout).code === "LEGACY_FROZEN_BASELINE_PASS",
  "LEGACY_FROZEN_DEFAULT_MISMATCH",
);
try {
  legacyGit(["read-tree", "HEAD"]);
  const blob = legacyGit(["hash-object", "-w", "--stdin"], {
      input: "# temporary governance fixture\nThis rule must never affect A07.\n",
    }).trim();
  legacyGit([
    "update-index",
    "--add",
    "--cacheinfo",
    `100644,${blob},docs/engineering/zerograph-a07-governance.md`,
  ]);
  const tree = legacyGit(["write-tree"]).trim(),
    commit = legacyGit(["commit-tree", tree, "-p", "HEAD", "-m", "A07 fixture"]).trim();
  execFileSync("git", ["update-ref", legacyFixtureRef, commit], { cwd: root });
  const afterRefCreation = legacyCheck(),
    afterRefCreationCheck = legacyCheck("--check");
  assert(
    afterRefCreation.status === 0 &&
      afterRefCreationCheck.status === 0 &&
      afterRefCreation.stdout === frozenNoArguments.stdout &&
      afterRefCreationCheck.stdout === frozenNoArguments.stdout,
    "LEGACY_REMOTE_REF_AFFECTED_FROZEN_CHECK",
  );
  for (const path of [
    "docs/engineering/LEGACY_KNOWLEDGE.json",
    "docs/engineering/LEGACY_COVERAGE.json",
  ]) {
    const fullPath = resolve(root, path), original = readFileSync(fullPath);
    try {
      const corrupted = JSON.parse(original);
      corrupted.corrupt = true;
      writeFileSync(fullPath, JSON.stringify(corrupted));
      assert(
        legacyFailure(legacyCheck("--check"), "LEGACY_FROZEN_BASELINE_DRIFT"),
        `LEGACY_FROZEN_DRIFT_NOT_DETECTED:${path}`,
      );
    } finally {
      writeFileSync(fullPath, original);
    }
  }
  assert(
    legacyFailure(legacyCheck("--write"), "LEGACY_REFRESH_REQUIRES_EXPLICIT_MODE"),
    "LEGACY_REFRESH_MODE_NOT_REQUIRED",
  );
} finally {
  execFileSync("git", ["update-ref", "-d", legacyFixtureRef], {
    cwd: root,
  });
  const afterRefDeletion = legacyCheck();
  assert(
    afterRefDeletion.status === 0 &&
      afterRefDeletion.stdout === frozenNoArguments.stdout,
    "LEGACY_DELETED_REF_AFFECTED_FROZEN_CHECK",
  );
  rmSync(legacyFixtureRoot, { recursive: true, force: true });
}
const refreshToken = `--${["re", "fresh"].join("")}`,
  normalCiSources = [
    workflow,
    readFileSync(resolve(root, "package.json"), "utf8"),
    readFileSync(import.meta.filename, "utf8"),
  ],
  executableRefreshPatterns = [
    new RegExp(`legacyCheck\\s*\\(\\s*["'\\x60]${refreshToken}["'\\x60]`),
    new RegExp(`legacy-ingest\\.mjs[^\\r\\n]*${refreshToken}`),
    new RegExp(`npm\\s+run\\s+legacy:ingest[^\\r\\n]*${refreshToken}`),
  ],
  executableRefreshFixtures = [
    `legacyCheck("${refreshToken}")`,
    `node scripts/engineering/legacy-ingest.mjs ${refreshToken}`,
    `npm run legacy:ingest -- ${refreshToken}`,
  ];
assert(
  executableRefreshFixtures.every((fixture) =>
    executableRefreshPatterns.some((pattern) => pattern.test(fixture)),
  ) &&
  !normalCiSources.some((source) =>
    executableRefreshPatterns.some((pattern) => pattern.test(source)),
  ),
  "CI_TRANSITIVE_LEGACY_REFRESH_PRESENT",
);
assert(
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) ===
    legacyStatusBefore,
  "LEGACY_FIXTURE_DIRTY_STATE_LEAKED",
);

const taskState = {
    originalTaskHash: "task",
    taskBaseHeadSha: "base",
    taskBaseDirtyFingerprint: "base-dirty",
    resolvedDomains: ["calls"],
    failureSignatures: ["failure"],
  },
  repositoryFixture = JSON.stringify({
    currentHeadSha: "head",
    currentTreeSha: "tree",
    currentDirtyFingerprint: "current-dirty",
  }),
  planFixture = JSON.stringify({
    planHash: "plan",
    changedPaths: ["src/app/call-logs/page.tsx"],
    unitProofs: [],
    postgresProofs: [],
    e2eProofs: [],
    domains: ["calls"],
    effects: ["UI"],
    risk: "R2",
  }),
  close = (learning) =>
    parse(
      runWithEnv(
        "scripts/engineering/task-close.mjs",
        {},
        {
          ZEROGRAPH_TASK_FIXTURE: JSON.stringify({ ...taskState, learning }),
          ZEROGRAPH_REPOSITORY_FIXTURE: repositoryFixture,
          ZEROGRAPH_TASK_PLAN_FIXTURE: planFixture,
        },
      ),
    );
assert(
  close([
    {
      classification: "KNOWN_RULE_ENFORCEMENT_GAP",
      failureSignature: "failure",
      lessonId: "SERVER_AUTHORIZATION",
      caughtBeforeEscape: false,
    },
  ]).nextAction.includes("LEARNING_CLOSEOUT_REQUIRED"),
  "KNOWN_GAP_DID_NOT_BLOCK_CERTIFICATION",
);
assert(
  close([
    {
      classification: "KNOWN_RULE_ENFORCEMENT_GAP",
      failureSignature: "failure",
      lessonId: "SERVER_AUTHORIZATION",
      caughtBeforeEscape: true,
    },
  ]).status === "TASK_LOCAL_COMPLETE",
  "EXISTING_ENFORCEMENT_CATCH_WAS_NOT_REUSED",
);
assert(
  close([
    {
      classification: "NOVEL_LESSON_REQUIRED",
      failureSignature: "failure",
    },
  ]).nextAction.includes("LEARNING_CLOSEOUT_REQUIRED"),
  "NOVEL_LESSON_DID_NOT_BLOCK_CERTIFICATION",
);
const proofPlanFixture = JSON.stringify({
    ...JSON.parse(planFixture),
    unitProofs: [{ id: "calls-unit" }],
  }),
  closeWithEvidence = (status, fingerprint) =>
    parse(
      runWithEnv(
        "scripts/engineering/task-close.mjs",
        {},
        {
          ZEROGRAPH_TASK_FIXTURE: JSON.stringify({
            ...taskState,
            failureSignatures: [],
            learning: [],
            proofEvidenceHashes: {
              "calls-unit": {
                status,
                headSha: "head",
                treeSha: "tree",
                dirtyFingerprint: fingerprint,
                planHash: "plan",
              },
            },
          }),
          ZEROGRAPH_REPOSITORY_FIXTURE: repositoryFixture,
          ZEROGRAPH_TASK_PLAN_FIXTURE: proofPlanFixture,
        },
      ),
    );
assert(
  closeWithEvidence("PASS", "stale").status === "IMPLEMENTATION_INCOMPLETE",
  "STALE_PROOF_WAS_REUSED",
);
assert(
  closeWithEvidence("FLAKY_DETECTED", "current-dirty").status ===
    "IMPLEMENTATION_INCOMPLETE",
  "FLAKY_PROOF_CERTIFIED",
);
assert(
  closeWithEvidence("PASS", "current-dirty").status === "TASK_LOCAL_COMPLETE",
  "CURRENT_PROOF_NOT_ACCEPTED",
);

const unresolved = parse(
    spawnSync(
      "node",
      [
        "scripts/engineering/legacy-reconcile.mjs",
        "--text",
        "purple semaphore bananas",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  ),
  independentlyMapped = parse(
    spawnSync(
      "node",
      [
        "scripts/engineering/legacy-reconcile.mjs",
        "--text",
        "external user is not an employee and cannot enter employee work queues",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
assert(unresolved.status === "UNRESOLVED", "LEGACY_FALLBACK_NOT_FAIL_CLOSED");
assert(
  independentlyMapped.preservedClaims.includes(
    "EXTERNAL_IDENTITY_NOT_EMPLOYEE",
  ),
  "LEGACY_CLAIM_MATCH_NOT_INDEPENDENT",
);

const platformImpact = parse(
    runStatelessWithEnv(
      "scripts/engineering/impact.mjs",
      {},
      { ZEROGRAPH_IMPACT_PATHS: '["scripts/handover/check.mjs"]' },
    ),
  ),
  handoverPlan = runStatelessWithEnv(
    "scripts/engineering/proof-plan.mjs",
    {},
    { ZEROGRAPH_IMPACT_PATHS: '["scripts/handover/check.mjs"]' },
  ),
  proofRegistry = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/PROOFS.json")),
  ),
  handoverMissing = runStatelessWithEnv(
    "scripts/engineering/proof-plan.mjs",
    {},
    {
      ZEROGRAPH_IMPACT_PATHS: '["scripts/handover/check.mjs"]',
      ZEROGRAPH_PROOFS_JSON: JSON.stringify({
        ...proofRegistry,
        proofs: proofRegistry.proofs.filter((proof) => proof.kind !== "handover"),
      }),
    },
  );
assert(
  platformImpact.domains.includes("platform-handover") &&
    platformImpact.effects.includes("PLATFORM") &&
    platformImpact.risk === "R3",
  "PLATFORM_HANDOVER_IMPACT_MISSING",
);
assert(
  handoverPlan.status === 0 &&
    parse(handoverPlan).handoverProofs.some(
      (proof) => proof.id === "supabase-handover-readiness",
    ),
  "HANDOVER_PROOF_NOT_SELECTED",
);
assert(
  handoverMissing.status !== 0 &&
    `${handoverMissing.stdout}${handoverMissing.stderr}`.includes(
      "HANDOVER_PROOF_UNMAPPED",
    ),
  "HANDOVER_PROOF_FAIL_CLOSED_MISSING",
);

const graphFallback = parse(
  spawnSync(
    "node",
    [
      "scripts/engineering/graphify-impact.mjs",
      "--task",
      "change Mapping button wording",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ZEROGRAPH_GRAPHIFY_BIN: "graphify-fixture-missing",
      },
    },
  ),
);
assert(
  graphFallback.graphifyState.includes("GRAPHIFY_UNAVAILABLE") &&
    graphFallback.authoritySource === "SEMANTIC_REGISTRIES_ONLY",
  "GRAPHIFY_FALLBACK_OR_AUTHORITY_ISOLATION_FAILED",
);
const ordinarySession = `ordinary-${randomUUID()}`;
runWithEnv(
  "scripts/engineering/hooks/user-prompt.mjs",
  { session_id: ordinarySession, prompt: "change Mapping button wording" },
  {},
);
const ordinaryPath = fixtureGit([
    "rev-parse",
    "--git-path",
    `zerograph/sessions/${ordinarySession}.json`,
  ]).trim(),
  ordinaryState = JSON.parse(readFileSync(resolve(root, ordinaryPath)));
assert(!ordinaryState.graphifyNavigation, "GRAPHIFY_RAN_FOR_ORDINARY_TASK");
const ambiguousSession = `ambiguous-${randomUUID()}`,
  ambiguousPrompt = "admin needs a distributor ERP filter";
runWithEnv(
  "scripts/engineering/hooks/user-prompt.mjs",
  { session_id: ambiguousSession, prompt: ambiguousPrompt },
  { ZEROGRAPH_GRAPHIFY_BIN: "graphify-fixture-missing" },
);
const ambiguousPath = fixtureGit([
    "rev-parse",
    "--git-path",
    `zerograph/sessions/${ambiguousSession}.json`,
  ]).trim(),
  ambiguousState = JSON.parse(readFileSync(resolve(root, ambiguousPath)));
assert(
  ambiguousState.graphifyNavigation?.status === "SEMANTIC_FALLBACK" &&
    !readFileSync(resolve(root, ambiguousPath), "utf8").includes(
      ambiguousPrompt,
    ),
  "GRAPHIFY_AMBIGUITY_TRIGGER_OR_PRIVACY_FAILED",
);
const navigationSession = `navigation-${randomUUID()}`;
runWithEnv(
  "scripts/engineering/task-close.mjs",
  {},
  {
    ZEROGRAPH_SESSION_ID: navigationSession,
    ZEROGRAPH_TASK_FIXTURE: JSON.stringify({
      ...taskState,
      session_id: navigationSession,
      failureSignatures: [],
      learning: [],
      graphifyNavigation: ambiguousState.graphifyNavigation,
      graphifyOutcome: "useful",
    }),
    ZEROGRAPH_REPOSITORY_FIXTURE: repositoryFixture,
    ZEROGRAPH_TASK_PLAN_FIXTURE: planFixture,
  },
);
const navigationPath = fixtureGit([
    "rev-parse",
    "--git-path",
    `zerograph/sessions/${navigationSession}.navigation.json`,
  ]).trim(),
  navigation = JSON.parse(readFileSync(resolve(root, navigationPath)));
assert(
  navigation.outcome === "useful" &&
    !JSON.stringify(navigation).includes(ambiguousPrompt),
  "GRAPHIFY_NAVIGATION_LEARNING_FAILED",
);

const fixtureRoot = mkdtempSync(resolve(tmpdir(), "zerograph-proof-path-"));
try {
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
    cwd: fixtureRoot,
  });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: fixtureRoot });
  mkdirSync(resolve(fixtureRoot, "proof"));
  writeFileSync(resolve(fixtureRoot, "proof/old.test.js"), "same proof\n");
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: fixtureRoot });
  const renameBase = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixtureRoot,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["mv", "proof/old.test.js", "proof/new.test.js"], {
    cwd: fixtureRoot,
  });
  execFileSync("git", ["commit", "-qm", "rename"], { cwd: fixtureRoot });
  assert(
    resolveProofPath(fixtureRoot, renameBase, "HEAD", "proof/old.test.js")
      .path === "proof/new.test.js",
    "PROOF_RENAME_REPAIR_FAILED",
  );
  writeFileSync(resolve(fixtureRoot, "proof/copy.test.js"), "same proof\n");
  execFileSync("git", ["add", "."], { cwd: fixtureRoot });
  execFileSync("git", ["commit", "-qm", "ambiguous"], { cwd: fixtureRoot });
  let ambiguous = false;
  try {
    resolveProofPath(fixtureRoot, renameBase, "HEAD", "proof/old.test.js");
  } catch (error) {
    ambiguous = String(error).includes("PROOF_PATH_STALE");
  }
  assert(ambiguous, "AMBIGUOUS_PROOF_RENAME_DID_NOT_FAIL_CLOSED");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
const graphifySource = readFileSync(
  resolve(root, "scripts/engineering/graphify-impact.mjs"),
  "utf8",
);
assert(
  graphifySource.includes('GRAPHIFY_QUERY_LOG_DISABLE: "1"') &&
    graphifySource.includes('"--budget", "500"') &&
    graphifySource.includes('authoritySource: "SEMANTIC_REGISTRIES_ONLY"'),
  "GRAPHIFY_PRIVACY_OR_AUTHORITY_GUARD_MISSING",
);
operationalSessionAfter = sessionSnapshot();
assert(
  JSON.stringify(operationalSessionAfter) === JSON.stringify(operationalSessionBefore),
  "OPERATIONAL_SESSION_STORE_MUTATED_BY_TEST",
);
} finally {
  try {
    rmSync(hookFixtureRoot, { recursive: true, force: true });
  } finally {
    if (existsSync(hookFixtureRoot))
      throw Error("ISOLATED_HOOK_FIXTURE_NOT_REMOVED");
  }
}
const snapshotHash = (snapshot) =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
console.log(
  JSON.stringify({
    code: "ZERO_GRAPH_CONTROL_PLANE_V2_FIXTURES_PASS",
    operationalSessionSnapshotBefore: snapshotHash(operationalSessionBefore),
    operationalSessionSnapshotAfter: snapshotHash(operationalSessionAfter),
    operationalSessionUnchanged: true,
    isolatedFixturePath: hookFixtureRoot,
    isolatedFixtureRemoved: !existsSync(hookFixtureRoot),
    isolatedGreenClosureProof,
  }),
);
