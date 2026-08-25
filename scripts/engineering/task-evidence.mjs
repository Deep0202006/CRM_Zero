import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadState,
  repositoryState,
  root,
  saveState,
  sha,
} from "./hooks/state.mjs";
const args = process.argv.slice(2),
  value = (k) => {
    const i = args.indexOf(k);
    return i < 0 ? undefined : args[i + 1];
  },
  session =
    value("--session") ?? process.env.ZEROGRAPH_SESSION_ID ?? "task-evidence",
  proof = value("--proof"),
  evidencePath = value("--evidence"),
  state = loadState(session),
  repo = repositoryState();
if (!proof || !evidencePath) {
  console.error("INVALID_TASK_EVIDENCE");
  process.exit(2);
}
const base = state.taskBaseHeadSha ?? "origin/main",
  plan = JSON.parse(
    execFileSync(
      "node",
      ["scripts/engineering/proof-plan.mjs", "--base", base, "--head", "HEAD"],
      { cwd: root, encoding: "utf8" },
    ),
  ),
  manifest = JSON.parse(readFileSync(resolve(root, evidencePath), "utf8")),
  result = manifest.results?.find((item) => item.proofId === proof),
  status = result?.status;
if (
  !["PASS", "FAIL", "FLAKY_DETECTED"].includes(status) ||
  manifest.headSha !== repo.currentHeadSha ||
  manifest.treeSha !== repo.currentTreeSha ||
  manifest.planHash !== plan.planHash
) {
  console.error("PROOF_STALE");
  process.exit(2);
}
const record = {
  proofId: proof,
  status,
  headSha: repo.currentHeadSha,
  treeSha: repo.currentTreeSha,
  dirtyFingerprint: repo.currentDirtyFingerprint,
  planHash: plan.planHash,
  evidenceHash: sha(readFileSync(resolve(root, evidencePath))),
};
state.proofEvidenceHashes = {
  ...(state.proofEvidenceHashes ?? {}),
  [proof]: record,
};
saveState({ ...state, ...repo, session_id: session });
console.log(JSON.stringify(record));
if (status !== "PASS") process.exit(1);
