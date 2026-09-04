import { resolve } from "node:path";
import { readHookInput, repositoryIdentity, resolveBoundTask, root, updateState } from "./state-store.mjs";
import { run, sha256 } from "../kernel-lib.mjs";
import { readFileSync } from "node:fs";
import { taskDirectory } from "../task-state.mjs";
import { validateReleaseReceipt } from "../release-controller.mjs";

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
export const previewGate = ({ head, cwd = root, vercel = (args) => run("vercel", args, { cwd }) } = {}) => { const result = vercel(["list", "zero_crm", "--scope", "zero-data", "--meta", `githubCommitSha=${head}`, "--json", "--limit", "20"]); if (result.status !== 0) return { status: /auth|login|network|connect|permission|timeout/i.test(`${result.stderr} ${result.error ?? ""}`) ? "EXTERNAL_DEPENDENCY" : "REMOTE_FAILED", reason: "PREVIEW_QUERY_FAILED" }; let rows; try { const parsed = JSON.parse(result.stdout); rows = Array.isArray(parsed) ? parsed : parsed.deployments; } catch { return { status: "REMOTE_FAILED", reason: "PREVIEW_OUTPUT_INVALID" }; } const preview = rows?.find((item) => (item.uid || item.id) && item.url && ["READY", "ready"].includes(item.state ?? item.status) && (item.target ?? item.environment) !== "production" && (item.meta?.githubCommitSha ?? item.gitSource?.sha ?? head) === head); return preview ? { status: "READY_TO_END", preview: { id: preview.uid ?? preview.id, url: String(preview.url).startsWith("http") ? preview.url : `https://${preview.url}`, head } } : { status: "REMOTE_PENDING", reason: "EXACT_HEAD_PREVIEW_NOT_READY" }; };
export const evaluateDurableTaskStop = (task) => { if (!task) return null; if (task.inspectOnly && task.status === "INSPECTION_READY") return { status: "READY_TO_END", reason: "INSPECTION_COMPLETE" }; const directory = taskDirectory(task.taskId), read = (name) => JSON.parse(readFileSync(resolve(directory, name), "utf8")), acceptance = read("acceptance.json"), plan = read("plan.json"), proof = read("proof.json"), delivery = read("delivery.json"), current = repositoryIdentity(root); if (task.headSha !== current.headSha || task.treeSha !== current.treeSha) return { status: "IMPLEMENTATION_IN_PROGRESS", reason: "TASK_HEAD_REFRESH_REQUIRED" }; if (task.status === "INVESTIGATION_REQUIRED") return { status: "SCOPE_UNRESOLVED", reason: "TASK_AMENDMENT_REQUIRES_PREPARATION" }; if (!acceptance.items?.length || acceptance.items.some((item) => item.status !== "PASS" || !item.evidence)) return { status: "IMPLEMENTATION_IN_PROGRESS", reason: "ACCEPTANCE_EVIDENCE_REQUIRED" }; if (!plan.rootCause || plan.rootCause === "PENDING" || !plan.writeScope?.length) return { status: "SCOPE_UNRESOLVED", reason: "ROOT_CAUSE_WRITE_SCOPE_REQUIRED" }; if ((task.requirementsRevision !== undefined && proof.requirementsRevision !== task.requirementsRevision) || proof.invalidatedProofIds?.length) return { status: "IMPLEMENTATION_IN_PROGRESS", reason: "CURRENT_REQUIREMENTS_PROOF_REQUIRED" }; if (!proof.focusedRuns?.length || proof.focusedRuns.some((item) => item.status !== "PASS" || item.head !== task.headSha)) return { status: "IMPLEMENTATION_IN_PROGRESS", reason: "CURRENT_FOCUSED_PROOF_REQUIRED" }; if (current.dirtyFingerprint !== sha256("")) return { status: "WORKTREE_DIRTY_COMMIT_REQUIRED" }; if (delivery.status === "OWNER_MIGRATION_REQUIRED") return { status: "HUMAN_APPROVAL_REQUIRED", reason: `OWNER_MIGRATION_REQUIRED:${(delivery.migrationFiles ?? []).join(",")}` }; if (delivery.status === "READY_FOR_RELEASE_APPROVAL") return { status: "HUMAN_APPROVAL_REQUIRED", reason: `OWNER_RELEASE_APPROVAL_REQUIRED:pr=${delivery.pr}:head=${delivery.head}` }; if (!validateReleaseReceipt(delivery) || delivery.task !== task.taskId || delivery.head !== current.headSha || !/^[0-9a-f]{40}$/.test(delivery.finalMainSha ?? "") || run("git", ["merge-base", "--is-ancestor", delivery.head, delivery.finalMainSha], { cwd: root }).status !== 0) return { status: "IMPLEMENTATION_IN_PROGRESS", reason: "CURRENT_RELEASE_RECEIPT_REQUIRED" }; return { status: "READY_TO_END", reason: "RELEASE_COMPLETE", releaseReceipt: delivery.releaseReceipt, mergeSha: delivery.mergeSha, finalMainSha: delivery.finalMainSha }; };

const stallEligible = new Set(["SCOPE_UNRESOLVED", "IMPLEMENTATION_IN_PROGRESS", "WORKTREE_DIRTY_COMMIT_REQUIRED"]);
export const applyStallPolicy = (state, result) => {
  const persistedStatus = result.status === "WORKTREE_DIRTY_COMMIT_REQUIRED" ? "IMPLEMENTATION_IN_PROGRESS" : result.status;
  if (!stallEligible.has(result.status)) return { result, state: { status: persistedStatus, stallCount: 0, progressSignature: undefined } };
  const progressSignature = JSON.stringify(result), stallCount = state.progressSignature === progressSignature ? Math.min(state.stallCount + 1, 3) : 1;
  if (stallCount >= 3) return { result: { status: "STALL_LIMIT", reason: result.status }, state: { status: "STALL_LIMIT", stallCount, progressSignature } };
  return { result, state: { status: persistedStatus, stallCount, progressSignature }, continuation: stallCount === 1 ? "FOCUSED_RETRY" : "STRATEGY_CHANGE_REQUIRED" };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const input = await readHookInput(), sessionId = input.session_id ?? "unknown";
  let result;
  let binding;
  try { binding = resolveBoundTask(sessionId); result = evaluateDurableTaskStop(binding.task); }
  catch (error) { result = { status: "SAFETY_CONFLICT", reason: error.message }; }
  let decision;
  if (binding) updateState(sessionId, (current) => { decision = applyStallPolicy(current, result); return { ...current, ...decision.state }; });
  else decision = { result, state: { stallCount: 0 } };
  result = decision.result;
  if (result.status !== "READY_TO_END") console.log(JSON.stringify(["EXTERNAL_DEPENDENCY", "HUMAN_APPROVAL_REQUIRED", "SAFETY_CONFLICT", "STALL_LIMIT"].includes(result.status) ? { stopReason: result.status, systemMessage: `${result.status}:${result.reason ?? "review required"}` } : { decision: "block", reason: `KERNEL_CONTINUE|taskId=${binding.task.taskId}|status=${result.status}|reason=${result.reason ?? "continue"}${decision.continuation ? `|strategy=${decision.continuation}|stallCount=${decision.state.stallCount}` : ""}` }));
}
