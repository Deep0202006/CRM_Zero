import { execFileSync } from "node:child_process";
import { loadState, readInput, root, saveState, sha } from "./state.mjs";
const input = await readInput(),
  remoteFixture = process.env.ZEROGRAPH_REMOTE_CHECK_FIXTURE
    ? JSON.parse(process.env.ZEROGRAPH_REMOTE_CHECK_FIXTURE)
    : null,
  output = (value) => console.log(JSON.stringify(value)),
  remoteBlock = (reason) => output({ decision: "block", reason }),
  remoteGate = (session_id, state) => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    let pr;
    try {
      pr = Object.hasOwn(remoteFixture ?? {}, "pr") ? remoteFixture.pr : JSON.parse(
        execFileSync("gh", ["pr", "view", "--json", "number,headRefOid,url"], {
          cwd: root,
          encoding: "utf8",
        }),
      );
    } catch (error) {
      if (/no pull requests found|no pull request/i.test(String(error.stderr ?? error)))
        return remoteBlock(
          "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=push the exact current HEAD and open a PR",
        );
      return output({
        stopReason: "EXTERNAL_DEPENDENCY",
        systemMessage: "EXTERNAL_DEPENDENCY: GitHub PR discovery is unavailable.",
      });
    }
    if (!pr)
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=push the exact current HEAD and open a PR",
      );
    if (pr.headRefOid !== head)
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=push the exact current HEAD to the PR branch",
      );
    let checks;
    try {
      checks = Object.hasOwn(remoteFixture ?? {}, "checks") ? remoteFixture.checks : JSON.parse(
        execFileSync(
          "gh",
          ["pr", "checks", "--required", "--json", "name,state,bucket,link"],
          { cwd: root, encoding: "utf8" },
        ),
      );
    } catch (error) {
      return output({
        stopReason: "EXTERNAL_DEPENDENCY",
        systemMessage: "EXTERNAL_DEPENDENCY: GitHub required-check query is unavailable.",
      });
    }
    if (checks.some((check) => ["fail", "cancel", "skipping"].includes(check.bucket)))
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=inspect and fix failed required checks",
      );
    if (!checks.length || checks.some((check) => check.bucket === "pending"))
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=gh pr checks --required --watch",
      );
    if (!checks.every((check) => check.bucket === "pass"))
      return remoteBlock(
        "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=gh pr checks --required --watch",
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
