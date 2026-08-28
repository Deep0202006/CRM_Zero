import { resolve } from "node:path";
import { loadState, readHookInput, repositoryIdentity, root, updateState } from "./state-store.mjs";
import { run, sha256 } from "../kernel-lib.mjs";

export const requiredRemoteChecks = Object.freeze(["preflight", "unit-build", "receivables-postgres", "e2e", "attest-evidence", "verify"]);
const validCheck = (check) => check && typeof check.name === "string" && check.name && typeof check.state === "string" && ["pass", "pending", "fail", "cancel", "skipping"].includes(check.bucket);
export const classifyChecks = (result) => {
  let checks;
  try { checks = JSON.parse(result.stdout); } catch { return { status: /auth|login|network|connect|permission|timeout/i.test(`${result.stderr} ${result.error ?? ""}`) ? "EXTERNAL_DEPENDENCY" : "REMOTE_FAILED", reason: "CHECK_OUTPUT_INVALID" }; }
  if (!Array.isArray(checks) || checks.some((check) => !validCheck(check))) return { status: "REMOTE_FAILED", reason: "CHECK_OUTPUT_MALFORMED" };
  const names = checks.map((check) => check.name);
  if (new Set(names).size !== names.length || requiredRemoteChecks.some((name) => !names.includes(name))) return { status: "REMOTE_FAILED", reason: "REQUIRED_CHECK_SET_MISMATCH" };
  if (checks.some((check) => ["fail", "cancel", "skipping"].includes(check.bucket) || /failure|error|cancel|timed.?out/i.test(check.state))) return { status: "REMOTE_FAILED", reason: "REQUIRED_CHECK_FAILED" };
  if (checks.some((check) => check.bucket === "pending" || /pending|queued|progress|waiting|requested/i.test(check.state))) return { status: "REMOTE_PENDING", reason: "REQUIRED_CHECK_PENDING" };
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
export const evaluateStopState = ({ state, cwd = root, remote = () => remoteGate({ cwd }) }) => {
  if (!state.taskId || state.resolution?.status !== "RESOLVED" || !state.baseline) return { status: "SCOPE_UNRESOLVED" };
  const current = repositoryIdentity(cwd);
  if (state.baseline.headSha === current.headSha && state.baseline.treeSha === current.treeSha && state.baseline.dirtyFingerprint === current.dirtyFingerprint) return { status: "IMPLEMENTATION_IN_PROGRESS" };
  if (current.dirtyFingerprint !== sha256("")) return { status: "WORKTREE_DIRTY_COMMIT_REQUIRED" };
  return remote();
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const input = await readHookInput(), sessionId = input.session_id ?? "unknown", state = loadState(sessionId);
  let result;
  try { result = evaluateStopState({ state }); }
  catch (error) { result = { status: "SAFETY_CONFLICT", reason: error.message }; }
  const signature = JSON.stringify(result);
  updateState(sessionId, (current) => ({ ...current, status: result.status === "WORKTREE_DIRTY_COMMIT_REQUIRED" ? "IMPLEMENTATION_IN_PROGRESS" : result.status, stallCount: current.progressSignature === signature ? current.stallCount + 1 : 0, progressSignature: signature }));
  if (result.status !== "READY_TO_END") console.log(JSON.stringify(["EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT"].includes(result.status) ? { stopReason: result.status, systemMessage: `${result.status}:${result.reason ?? "review required"}` } : { decision: "block", reason: `KERNEL_CONTINUE|taskId=${state.taskId}|status=${result.status}|reason=${result.reason ?? "continue"}` }));
}
