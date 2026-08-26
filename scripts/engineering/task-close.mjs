import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadState, repositoryState, root, saveState } from "./hooks/state.mjs";
const args = process.argv.slice(2),
  value = (k) => {
    const i = args.indexOf(k);
    return i < 0 ? undefined : args[i + 1];
  },
  session = value("--session") ?? process.env.ZEROGRAPH_SESSION_ID ?? "unknown",
  state = process.env.ZEROGRAPH_TASK_FIXTURE
    ? JSON.parse(process.env.ZEROGRAPH_TASK_FIXTURE)
    : loadState(session),
  repo = process.env.ZEROGRAPH_REPOSITORY_FIXTURE
    ? JSON.parse(process.env.ZEROGRAPH_REPOSITORY_FIXTURE)
    : repositoryState(),
  out = (status, nextAction = null, details = {}) => {
    const result = { status, nextAction, ...details };
    console.log(JSON.stringify(result));
    return result;
  };
const main = () => {
  if (!state.originalTaskHash || !state.taskBaseHeadSha)
    return void out(
      "IMPLEMENTATION_INCOMPLETE",
      "Resolve the Owner task and preserve its repository baseline.",
    );
  const changed =
    state.taskBaseHeadSha !== repo.currentHeadSha ||
    state.taskBaseDirtyFingerprint !== repo.currentDirtyFingerprint;
  if (!changed) {
    if (
      state.requestedImplementation &&
      !(state.noChangeEvidenceHashes ?? []).length
    )
      return void out(
        "IMPLEMENTATION_INCOMPLETE",
        "Record current-source/test evidence for NO_CHANGE_REQUIRED or implement the requested change.",
      );
    saveState({ ...state, ...repo, session_id: session, taskClosed: true });
    return void out("NO_CHANGE_REQUIRED", null, {
      evidence:
        "current source/test evidence satisfies the task or the task was informational",
    });
  }
  if (!(state.resolvedDomains ?? []).length)
    return void out(
      "IMPLEMENTATION_INCOMPLETE",
      "Run task-only context resolution.",
    );
  let plan;
  try {
    plan = process.env.ZEROGRAPH_TASK_PLAN_FIXTURE
      ? JSON.parse(process.env.ZEROGRAPH_TASK_PLAN_FIXTURE)
      : JSON.parse(
          execFileSync(
            "node",
            [
              "scripts/engineering/proof-plan.mjs",
              "--base",
              state.taskBaseHeadSha,
              "--head",
              "HEAD",
            ],
            { cwd: root, encoding: "utf8" },
          ),
        );
  } catch (e) {
    return void out("SAFETY_CONFLICT", null, {
      code: String(e.stderr ?? e.message).trim(),
    });
  }
  let contract = null;
  if (plan.risk === "R3" || plan.domains.includes("engineering-control") || plan.domains.includes("platform-handover")) {
    try {
      contract = JSON.parse(execFileSync("node", ["scripts/engineering/task-contract.mjs", "--check", "--base", state.taskBaseHeadSha, "--head", "HEAD"], { cwd: root, encoding: "utf8" }));
    } catch (error) {
      return void out("IMPLEMENTATION_INCOMPLETE", "TASK_CONTRACT_REQUIRED", { code: String(error.stderr ?? error.message).trim() });
    }
    if (state.originalTaskHash !== contract.ownerIntentHash || state.taskBaseHeadSha !== contract.originBaseSha)
      return void out("IMPLEMENTATION_INCOMPLETE", "TASK_CONTRACT_BASELINE_MISMATCH");
    if (!contract.domains.every((domain) => state.resolvedDomains.includes(domain)))
      return void out("IMPLEMENTATION_INCOMPLETE", "TASK_CONTRACT_DOMAIN_MISMATCH");
  }
  const mandatory = [
      ...plan.unitProofs,
      ...plan.postgresProofs,
      ...plan.e2eProofs,
      ...(plan.handoverProofs ?? []),
    ].map((p) => p.id),
    evidence = state.proofEvidenceHashes ?? {},
    missing = mandatory.filter((id) => {
      const e = evidence[id];
      return (
        !e ||
        e.status !== "PASS" ||
        e.headSha !== repo.currentHeadSha ||
        e.dirtyFingerprint !== repo.currentDirtyFingerprint ||
        e.planHash !== plan.planHash
      );
    });
  if (missing.length)
    return void out(
      plan.postgresProofs.some((p) => missing.includes(p.id))
        ? "AWAITING_REMOTE_EVIDENCE"
        : "IMPLEMENTATION_INCOMPLETE",
      `Run required proof: ${missing[0]}`,
      { planHash: plan.planHash, missing },
    );
  const incompleteCriterion = contract?.criteria.find((criterion) => {
    const evidence = state.taskAcceptanceEvidence?.[criterion.id];
    return !evidence || evidence.status !== "PASS" || evidence.headSha !== repo.currentHeadSha || evidence.treeSha !== repo.currentTreeSha || evidence.planHash !== plan.planHash;
  });
  if (incompleteCriterion)
    return void out("IMPLEMENTATION_INCOMPLETE", incompleteCriterion.id, { planHash: plan.planHash });
  const changedPaths = new Set(plan.changedPaths),
    learning = state.learning ?? [];
  const unclassifiedFailure = (state.failureSignatures ?? []).find(
    (signature) =>
      !learning.some((item) => item.failureSignature === signature),
  );
  if (unclassifiedFailure)
    return void out(
      "IMPLEMENTATION_INCOMPLETE",
      `LEARNING_CLOSEOUT_REQUIRED: classify failure ${unclassifiedFailure} with npm run learn:close for session ${session}, using a sanitized description of the observed invariant gap.`,
    );
  for (const item of learning) {
    if (
      item.classification === "KNOWN_RULE_ENFORCEMENT_GAP" &&
      !item.caughtBeforeEscape
    ) {
      const lesson = JSON.parse(
          readFileSync(resolve(root, "docs/engineering/LESSONS.json")),
        ).lessons.find((x) => x.id === item.lessonId),
        strengthened = [
          ...(lesson?.enforcementRefs ?? []),
          ...(lesson?.evalRefs ?? []),
        ].some(
          (path) =>
            changedPaths.has(path) ||
            (path === "docs/engineering/ENGINEERING_GOLDEN_CASES.json" &&
              changedPaths.has(path)),
        );
      if (!strengthened)
        return void out(
          "IMPLEMENTATION_INCOMPLETE",
          "LEARNING_CLOSEOUT_REQUIRED: strengthen the matched enforcement or Golden eval.",
        );
    }
    if (item.classification === "NOVEL_LESSON_REQUIRED") {
      const registryPaths = [
        "docs/engineering/CLAIMS.json",
        "docs/engineering/LESSONS.json",
        "docs/engineering/ENGINEERING_GOLDEN_CASES.json",
      ];
      const lessons = JSON.parse(
        readFileSync(resolve(root, "docs/engineering/LESSONS.json")),
      ).lessons;
      const durable = lessons.some(
        (lesson) =>
          (lesson.provenance ?? []).includes(item.failureSignature) &&
          (lesson.evalRefs ?? []).length &&
          (lesson.kind !== "mechanical" ||
            (lesson.enforcementRefs ?? []).length),
      );
      if (!registryPaths.every((path) => changedPaths.has(path)) || !durable)
        return void out(
          "IMPLEMENTATION_INCOMPLETE",
          "LEARNING_CLOSEOUT_REQUIRED: add claim, lesson, enforcement/eval, and failure-signature provenance.",
        );
    }
  }
  if (state.graphifyNavigation) {
    const path = resolve(
      root,
      execFileSync(
        "git",
        [
          "rev-parse",
          "--git-path",
          `zerograph/sessions/${session}.navigation.json`,
        ],
        { cwd: root, encoding: "utf8" },
      ).trim(),
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        ...state.graphifyNavigation,
        outcome: state.graphifyOutcome ?? "useful",
      }),
    );
    const graphify = process.env.ZEROGRAPH_GRAPHIFY_BIN ?? "graphify",
      help = spawnSync(graphify, ["save-result", "--help"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GRAPHIFY_QUERY_LOG_DISABLE: "1" },
      });
    if (help.status === 0)
      spawnSync(
        graphify,
        [
          "save-result",
          JSON.stringify({
            taskHash: state.originalTaskHash,
            domains: state.resolvedDomains,
            paths: state.graphifyNavigation.paths,
            outcome: state.graphifyOutcome ?? "useful",
          }),
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, GRAPHIFY_QUERY_LOG_DISABLE: "1" },
        },
      );
  }
  const certified =
    state.remoteEvidence?.headSha === repo.currentHeadSha &&
    state.remoteEvidence?.treeSha === repo.currentTreeSha &&
    state.remoteEvidence?.planHash === plan.planHash &&
    state.remoteEvidence?.status === "PASS";
  saveState({
    ...state,
    taskPlanHash: plan.planHash,
    ...repo,
    session_id: session,
    taskClosed: certified,
  });
  out(certified ? "TASK_CERTIFIED" : "TASK_LOCAL_COMPLETE", null, {
    planHash: plan.planHash,
    domains: plan.domains,
    effects: plan.effects,
    risk: plan.risk,
  });
};
main();
