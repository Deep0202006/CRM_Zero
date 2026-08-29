import { resolve } from "node:path";
import { loadState, readHookInput, repositoryIdentity, root, updateState } from "./state-store.mjs";
import { run, sha256 } from "../kernel-lib.mjs";

export const protectedRequiredChecks = Object.freeze(["preflight", "verify", "receivables-postgres", "e2e"]);
export const requiredRemoteChecks = Object.freeze(["preflight", "unit-build", "receivables-postgres", "e2e", "attest-evidence", "verify"]);
const validCheck = (check) => check && typeof check.name === "string" && check.name && typeof check.state === "string" && check.state && typeof check.link === "string" && ["pass", "pending", "fail", "cancel", "skipping"].includes(check.bucket);
const parseChecks = (result) => {
  let checks;
  try { checks = JSON.parse(result.stdout); } catch { return { status: /auth|login|network|connect|permission|timeout/i.test(`${result.stderr} ${result.error ?? ""}`) ? "EXTERNAL_DEPENDENCY" : "REMOTE_FAILED", reason: "CHECK_OUTPUT_INVALID" }; }
  if (!Array.isArray(checks) || checks.some((check) => !validCheck(check))) return { status: "REMOTE_FAILED", reason: "CHECK_OUTPUT_MALFORMED" };
  return { checks };
};
const classifySelectedChecks = (checks, names, { rejectAllDuplicates = false } = {}) => {
  const selected = checks.filter((check) => names.includes(check.name)), selectedNames = selected.map((check) => check.name), allNames = checks.map((check) => check.name);
  if ((rejectAllDuplicates && new Set(allNames).size !== allNames.length) || new Set(selectedNames).size !== selectedNames.length || names.some((name) => !selectedNames.includes(name))) return { status: "REMOTE_FAILED", reason: "REQUIRED_CHECK_SET_MISMATCH" };
  return classifyCheckStates(selected);
};
const classifyCheckStates = (checks) => {
  if (checks.some((check) => ["fail", "cancel", "skipping"].includes(check.bucket) || /failure|error|cancel|timed.?out/i.test(check.state))) return { status: "REMOTE_FAILED", reason: "REQUIRED_CHECK_FAILED" };
  if (checks.some((check) => check.bucket === "pending" || /pending|queued|progress|waiting|requested/i.test(check.state))) return { status: "REMOTE_PENDING", reason: "REQUIRED_CHECK_PENDING" };
  return checks.every((check) => check.bucket === "pass" && check.state === "SUCCESS") ? { status: "READY_TO_END", checks } : { status: "REMOTE_FAILED", reason: "CHECK_OUTPUT_MALFORMED" };
};
export const classifyProtectedChecks = (result) => {
  const parsed = parseChecks(result);
  if (!parsed.checks) return parsed;
  const selected = classifySelectedChecks(parsed.checks, protectedRequiredChecks, { rejectAllDuplicates: true });
  if (selected.status !== "READY_TO_END") return selected;
  return classifyCheckStates(parsed.checks);
};
export const classifyChecks = (result) => {
  const parsed = parseChecks(result);
  return parsed.checks ? classifySelectedChecks(parsed.checks, requiredRemoteChecks) : parsed;
};
const combineCheckResults = (protectedResult, workflowResult) => {
  if ([protectedResult, workflowResult].some((result) => result.status === "REMOTE_FAILED")) return { status: "REMOTE_FAILED", reason: protectedResult.status === "REMOTE_FAILED" ? protectedResult.reason : workflowResult.reason };
  if ([protectedResult, workflowResult].some((result) => result.status === "EXTERNAL_DEPENDENCY")) return { status: "EXTERNAL_DEPENDENCY", reason: "CHECKS_UNAVAILABLE" };
  if ([protectedResult, workflowResult].some((result) => result.status === "REMOTE_PENDING")) return { status: "REMOTE_PENDING", reason: "REQUIRED_CHECK_PENDING" };
  return { status: "READY_TO_END", protectedChecks: protectedResult.checks, workflowChecks: workflowResult.checks };
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
  const fields = ["--json", "name,state,bucket,link"];
  const protectedResult = classifyProtectedChecks(gh(["pr", "checks", String(pr.number), "--required", ...fields]));
  const workflowResult = classifyChecks(gh(["pr", "checks", String(pr.number), ...fields]));
  return { ...combineCheckResults(protectedResult, workflowResult), pr };
};
export const evaluateStopState = ({ state, cwd = root, remote = () => remoteGate({ cwd }) }) => {
  if (!state.taskId || state.resolution?.status !== "RESOLVED" || !state.baseline) return { status: "SCOPE_UNRESOLVED" };
  const current = repositoryIdentity(cwd);
  if (state.baseline.headSha === current.headSha && state.baseline.treeSha === current.treeSha && state.baseline.dirtyFingerprint === current.dirtyFingerprint) return { status: "IMPLEMENTATION_IN_PROGRESS" };
  if (current.dirtyFingerprint !== sha256("")) return { status: "WORKTREE_DIRTY_COMMIT_REQUIRED" };
  return remote();
};

const stallEligible = new Set(["SCOPE_UNRESOLVED", "IMPLEMENTATION_IN_PROGRESS", "WORKTREE_DIRTY_COMMIT_REQUIRED"]);
export const applyStallPolicy = (state, result) => {
  const persistedStatus = result.status === "WORKTREE_DIRTY_COMMIT_REQUIRED" ? "IMPLEMENTATION_IN_PROGRESS" : result.status;
  if (!stallEligible.has(result.status)) return { result, state: { status: persistedStatus, stallCount: 0, progressSignature: undefined } };
  const progressSignature = JSON.stringify(result), stallCount = state.progressSignature === progressSignature ? Math.min(state.stallCount + 1, 3) : 1;
  if (stallCount >= 3) return { result: { status: "STALL_LIMIT", reason: result.status }, state: { status: "STALL_LIMIT", stallCount, progressSignature } };
  return { result, state: { status: persistedStatus, stallCount, progressSignature }, continuation: stallCount === 1 ? "FOCUSED_RETRY" : "STRATEGY_CHANGE_REQUIRED" };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const input = await readHookInput(), sessionId = input.session_id ?? "unknown", state = loadState(sessionId);
  let result;
  try { result = evaluateStopState({ state }); }
  catch (error) { result = { status: "SAFETY_CONFLICT", reason: error.message }; }
  let decision;
  updateState(sessionId, (current) => { decision = applyStallPolicy(current, result); return { ...current, ...decision.state }; });
  result = decision.result;
  if (result.status !== "READY_TO_END") console.log(JSON.stringify(["EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT", "STALL_LIMIT"].includes(result.status) ? { stopReason: result.status, systemMessage: `${result.status}:${result.reason ?? "review required"}` } : { decision: "block", reason: `KERNEL_CONTINUE|taskId=${state.taskId}|status=${result.status}|reason=${result.reason ?? "continue"}${decision.continuation ? `|strategy=${decision.continuation}|stallCount=${decision.state.stallCount}` : ""}` }));
}
