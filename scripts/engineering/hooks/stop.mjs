import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProofPlan } from "../proof-plan.mjs";
import { loadState, readHookInput, repositoryIdentity, root, updateState } from "./state-store.mjs";
import { run } from "../kernel-lib.mjs";

const validCheck = (check) => check && typeof check.name === "string" && check.name && typeof check.state === "string" && ["pass", "pending", "fail", "cancel", "skipping"].includes(check.bucket);
export const classifyChecks = (result) => {
  let checks;
  try { checks = JSON.parse(result.stdout); } catch { return { status: /auth|login|network|connect|permission|timeout/i.test(`${result.stderr} ${result.error ?? ""}`) ? "EXTERNAL_DEPENDENCY" : "REMOTE_FAILED", reason: "CHECK_OUTPUT_INVALID" }; }
  if (!Array.isArray(checks) || checks.some((check) => !validCheck(check))) return { status: "REMOTE_FAILED", reason: "CHECK_OUTPUT_MALFORMED" };
  if (checks.some((check) => ["fail", "cancel", "skipping"].includes(check.bucket) || /failure|error|cancel|timed.?out/i.test(check.state))) return { status: "REMOTE_FAILED", reason: "REQUIRED_CHECK_FAILED" };
  if (!checks.length || checks.some((check) => check.bucket === "pending" || /pending|queued|progress|waiting|requested/i.test(check.state))) return { status: "REMOTE_PENDING", reason: "REQUIRED_CHECK_PENDING" };
  return checks.every((check) => check.bucket === "pass" && check.state === "SUCCESS") ? { status: "READY_TO_END", checks } : { status: "REMOTE_FAILED", reason: "CHECK_OUTPUT_MALFORMED" };
};
export const remoteGate = ({ cwd = root, gh = (args) => run("gh", args, { cwd }) } = {}) => {
  const head = run("git", ["rev-parse", "HEAD"], { cwd }).stdout.trim(), prResult = gh(["pr", "view", "--json", "number,headRefOid,baseRefOid,baseRefName,url"]);
  let pr;
  try { pr = JSON.parse(prResult.stdout); } catch { return /no pull request/i.test(prResult.stderr) ? { status: "PR_REQUIRED" } : { status: "EXTERNAL_DEPENDENCY", reason: "PR_METADATA_UNAVAILABLE" }; }
  if (!pr.number || !pr.headRefOid || !pr.baseRefOid) return { status: "EXTERNAL_DEPENDENCY", reason: "PR_METADATA_INCOMPLETE" };
  if (pr.headRefOid !== head) return { status: "REMOTE_FAILED", reason: "HEAD_MISMATCH" };
  const base = run("git", ["merge-base", "--is-ancestor", pr.baseRefOid, "HEAD"], { cwd });
  if (base.status === 1) return { status: "REMOTE_FAILED", reason: "BASE_NOT_ANCESTOR" };
  if (base.status !== 0) return { status: "EXTERNAL_DEPENDENCY", reason: "BASE_CHECK_UNAVAILABLE" };
  return { ...classifyChecks(gh(["pr", "checks", String(pr.number), "--required", "--json", "name,state,bucket,link"])), pr };
};
const evidenceCurrent = (plan) => plan.requiredProofs.every((proofId) => {
  const path = resolve(root, `artifacts/engineering-evidence/${proofId}.json`);
  if (!existsSync(path)) return false;
  try { const item = JSON.parse(readFileSync(path, "utf8")); return item.status === "PASS" && item.headSha === plan.headSha && item.treeSha === plan.treeSha && item.baseSha === plan.baseSha && item.impactHash === plan.impactHash && item.planHash === plan.planHash && item.dirtyFingerprint === repositoryIdentity().dirtyFingerprint; }
  catch { return false; }
});
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const input = await readHookInput(), sessionId = input.session_id ?? "unknown", state = loadState(sessionId);
  let result;
  try {
    if (!state.taskId || state.resolution?.status !== "RESOLVED") result = { status: "SCOPE_UNRESOLVED" };
    else if (state.baseline?.dirtyFingerprint === repositoryIdentity().dirtyFingerprint && state.baseline?.headSha === repositoryIdentity().headSha) result = { status: "IMPLEMENTATION_IN_PROGRESS" };
    else { const plan = compileProofPlan({ base: state.baseline.baseSha, head: "WORKTREE" }); result = evidenceCurrent(plan) ? remoteGate() : { status: "LOCAL_PROOFS_REQUIRED" }; }
  } catch (error) { result = { status: "SAFETY_CONFLICT", reason: error.message }; }
  const signature = JSON.stringify(result), same = state.progressSignature === signature, stallCount = same ? state.stallCount + 1 : 0;
  if (stallCount >= 3 && !["READY_TO_END", "EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT"].includes(result.status)) result = { status: "STALL_LIMIT", reason: signature };
  updateState(sessionId, (current) => ({ ...current, status: result.status, stallCount, progressSignature: signature }));
  if (result.status !== "READY_TO_END") console.log(JSON.stringify(["EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT", "STALL_LIMIT"].includes(result.status) ? { stopReason: result.status, systemMessage: `${result.status}:${result.reason ?? "review required"}` } : { decision: "block", reason: `KERNEL_CONTINUE|taskId=${state.taskId}|status=${result.status}|reason=${result.reason ?? "continue"}` }));
}
