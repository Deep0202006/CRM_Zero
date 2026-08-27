import { execFileSync, spawnSync } from "node:child_process";
import { loadState, readInput, root, saveState, sha } from "./state.mjs";
const input = await readInput(),
  output = (value) => console.log(JSON.stringify(value)),
  remoteBlock = (reason) => output({ decision: "block", reason }),
  external = (message) =>
    output({
      stopReason: "EXTERNAL_DEPENDENCY",
      systemMessage: `EXTERNAL_DEPENDENCY: ${message}`,
    }),
  run = (file, args) => {
    const result = spawnSync(file, args, { cwd: root, encoding: "utf8" });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? String(result.error ?? ""),
    };
  },
  gh = (args) =>
    process.env.ZEROGRAPH_GH_FIXTURE
      ? run(process.execPath, [process.env.ZEROGRAPH_GH_FIXTURE, ...args])
      : run("gh", args),
  json = (result) => {
    try {
      return JSON.parse(result.stdout);
    } catch {
      return null;
    }
  },
  remoteGate = (session_id, state) => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const prResult = gh([
        "pr",
        "view",
        "--json",
        "number,headRefOid,baseRefOid,baseRefName,url",
      ]),
      pr = json(prResult);
    if (!pr)
      return /no pull requests found|no pull request/i.test(prResult.stderr)
        ? remoteBlock(
            "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=push the exact current HEAD and open a PR",
          )
        : external("GitHub PR metadata is unavailable.");
    if (!pr.number || !pr.headRefOid || !pr.baseRefOid || !pr.baseRefName)
      return external("GitHub PR metadata is incomplete.");
    if (pr.headRefOid !== head)
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=HEAD_MISMATCH|command=push the exact current HEAD to the PR branch",
      );
    const base = run("git", ["merge-base", "--is-ancestor", pr.baseRefOid, "HEAD"]);
    if (base.status === 1)
      return remoteBlock(
        `ZEROGRAPH_CONTINUE|status=STALE_BASE|base=${pr.baseRefName}|command=rebase onto the current PR base`,
      );
    if (base.status !== 0)
      return external("PR base containment could not be verified.");
    const checksResult = gh([
        "pr",
        "checks",
        String(pr.number),
        "--required",
        "--json",
        "name,state,bucket,link",
      ]),
      checks = json(checksResult);
    if (!Array.isArray(checks))
      return external("GitHub required-check state is unavailable.");
    if (
      checks.some(
        (check) =>
          ["fail", "cancel", "skipping"].includes(check.bucket) ||
          /cancel|timed.?out|failure|error/i.test(check.state),
      )
    )
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=REMOTE_CHECKS_FAILED|command=inspect and fix failed required checks",
      );
    if (!checks.length || checks.some((check) => check.bucket === "pending"))
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=REMOTE_CHECKS_PENDING|command=gh pr checks --required --watch",
      );
    if (!checks.every((check) => check.bucket === "pass"))
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=REMOTE_CHECKS_PENDING|command=gh pr checks --required --watch",
      );
    saveState({
      ...state,
      session_id,
      taskClosed: true,
      remoteEvidence: { headSha: head, checkNames: checks.map((check) => check.name) },
    });
  };
const session_id = input.session_id ?? "unknown",
  state = loadState(session_id),
  acceptance = process.env.ZEROGRAPH_ACCEPTANCE_FIXTURE
    ? JSON.parse(process.env.ZEROGRAPH_ACCEPTANCE_FIXTURE)
    : JSON.parse(
        execFileSync(
          "node",
          ["scripts/engineering/os-acceptance.mjs", "--mode", "stop"],
          { cwd: root, encoding: "utf8" },
        ),
      );
let status, nextAction, signature;
if (!acceptance.localComplete) {
  status = "IMPLEMENTATION_INCOMPLETE";
  nextAction = `acceptance=${acceptance.nextAction.acceptanceId}|command=${acceptance.nextAction.command}`;
  signature = acceptance.progressSignature;
} else {
  const task = process.env.ZEROGRAPH_TASK_CLOSE_FIXTURE
    ? JSON.parse(process.env.ZEROGRAPH_TASK_CLOSE_FIXTURE)
    : JSON.parse(
        execFileSync(
          "node",
          ["scripts/engineering/task-close.mjs", "--session", session_id],
          { cwd: root, encoding: "utf8" },
        ),
      );
  status = task.status;
  nextAction = task.nextAction;
  signature = sha(
    JSON.stringify({
      status,
      nextAction,
      acceptance: acceptance.progressSignature,
      current: state.currentDirtyFingerprint,
    }),
  );
  if (["NO_CHANGE_REQUIRED", "TASK_CERTIFIED"].includes(status))
    process.exit(0);
  if (["TASK_LOCAL_COMPLETE", "AWAITING_REMOTE_EVIDENCE"].includes(status)) {
    remoteGate(session_id, state);
    process.exit(0);
  }
  if (
    [
      "HUMAN_APPROVAL_REQUIRED",
      "EXTERNAL_DEPENDENCY",
      "SAFETY_CONFLICT",
    ].includes(status)
  ) {
    output({
      stopReason: status,
      systemMessage: `${status}: ${nextAction ?? "external evidence required"}`,
    });
    process.exit(0);
  }
}
const same = state.progressSignature === signature,
  stallCount = same ? (state.stallCount ?? 0) + 1 : 0;
saveState({ ...state, session_id, progressSignature: signature, stallCount });
if (stallCount >= 3)
  output({
      stopReason: "STALL_LIMIT",
      systemMessage: `STALL_LIMIT status=${status} evidence=${signature}`,
    });
else {
  const prefix =
    stallCount === 2
      ? "ZEROGRAPH_STALL_REPORT"
      : stallCount === 1
        ? "ZEROGRAPH_CONTINUE|strategy-change"
        : "ZEROGRAPH_CONTINUE";
  output({
      decision: "block",
      reason: `${prefix}|status=${status}|command=${nextAction}`,
    });
}
