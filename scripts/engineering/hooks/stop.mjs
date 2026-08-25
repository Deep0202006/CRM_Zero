import { execFileSync } from "node:child_process";
import { loadState, readInput, root, saveState, sha } from "./state.mjs";
const input = await readInput();
if (input.stop_hook_active) process.exit(0);
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
  if (
    [
      "AWAITING_REMOTE_EVIDENCE",
      "HUMAN_APPROVAL_REQUIRED",
      "EXTERNAL_DEPENDENCY",
      "SAFETY_CONFLICT",
    ].includes(status)
  ) {
    console.log(
      JSON.stringify({
        stopReason: status,
        systemMessage: `${status}: ${nextAction ?? "external evidence required"}`,
      }),
    );
    process.exit(0);
  }
  if (status === "TASK_LOCAL_COMPLETE") {
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "ZEROGRAPH_CONTINUE|status=AWAITING_REMOTE_EVIDENCE|command=push exact head and wait for GitHub/Vercel evidence",
      }),
    );
    process.exit(0);
  }
}
const same = state.progressSignature === signature,
  stallCount = same ? (state.stallCount ?? 0) + 1 : 0;
saveState({ ...state, session_id, progressSignature: signature, stallCount });
if (stallCount >= 3)
  console.log(
    JSON.stringify({
      stopReason: "STALL_LIMIT",
      systemMessage: `STALL_LIMIT status=${status} evidence=${signature}`,
    }),
  );
else {
  const prefix =
    stallCount === 2
      ? "ZEROGRAPH_STALL_REPORT"
      : stallCount === 1
        ? "ZEROGRAPH_CONTINUE|strategy-change"
        : "ZEROGRAPH_CONTINUE";
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `${prefix}|status=${status}|command=${nextAction}`,
    }),
  );
}
