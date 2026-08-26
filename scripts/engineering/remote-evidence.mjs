import { execFileSync, spawnSync } from "node:child_process";
import { loadState, repositoryState, root, saveState } from "./hooks/state.mjs";

const session = process.env.ZEROGRAPH_SESSION_ID ?? "unknown", repo = repositoryState();
const run = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const plan = () => JSON.parse(execFileSync("node", ["scripts/engineering/proof-plan.mjs", "--base", "origin/main", "--head", "HEAD"], { cwd: root, encoding: "utf8" }));
const output = (status, details = {}, exitCode = 0) => { saveState({ ...loadState(session), ...repo, session_id: session, remoteEvidence: details.remoteEvidence ?? { status: "FAIL", ...details } }); console.log(JSON.stringify({ status, ...details })); process.exit(exitCode); };
const inaccessible = (error) => /authentication|login|network|api|permission|forbidden|rate limit|could not resolve|connection/i.test(String(error));
const fixture = process.env.ZEROGRAPH_REMOTE_FIXTURE ? JSON.parse(process.env.ZEROGRAPH_REMOTE_FIXTURE) : null;
if (fixture) {
  const failed = (fixture.checks ?? []).filter((check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.state));
  if (failed.length) output("REMOTE_EVIDENCE_FAILED", { code: "REQUIRED_CHECK_FAILED", failures: failed }, 2);
  output("REMOTE_EVIDENCE_PASS", { remoteEvidence: { status: "PASS", headSha: fixture.headSha ?? repo.currentHeadSha, treeSha: fixture.treeSha ?? repo.currentTreeSha, planHash: fixture.planHash, requiredChecks: (fixture.checks ?? []).map((x) => x.name), terminalChecks: fixture.checks ?? [] } });
}
try {
  const proof = plan(), pr = JSON.parse(run(["pr", "view", "--json", "number,headRefOid"]));
  if (pr.headRefOid !== repo.currentHeadSha) output("REMOTE_EVIDENCE_FAILED", { code: "PR_HEAD_STALE", expected: repo.currentHeadSha, actual: pr.headRefOid }, 2);
  const readChecks = () => JSON.parse(run(["pr", "checks", "--json", "name,state,link,description"]));
  let checks = readChecks();
  if (checks.some((check) => ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING"].includes(check.state))) {
    const watched = spawnSync("gh", ["pr", "checks", "--watch", "--interval", "10"], { cwd: root, encoding: "utf8" });
    checks = readChecks(); // A non-zero watch is not evidence; the re-query is.
    if (checks.some((check) => ["PENDING", "QUEUED", "IN_PROGRESS", "WAITING"].includes(check.state))) output("REMOTE_EVIDENCE_PENDING", { remoteEvidence: { status: "PENDING", headSha: repo.currentHeadSha, treeSha: repo.currentTreeSha, planHash: proof.planHash, requiredChecks: checks.map((x) => x.name), terminalChecks: checks }, watchExitCode: watched.status }, 2);
  }
  const failed = checks.filter((check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.state));
  if (failed.length) output("REMOTE_EVIDENCE_FAILED", { code: "REQUIRED_CHECK_FAILED", failures: failed.map(({ name, state, link, description }) => ({ name, state, link, description: String(description ?? "").slice(0, 240) })) }, 2);
  output("REMOTE_EVIDENCE_PASS", { remoteEvidence: { status: "PASS", headSha: repo.currentHeadSha, treeSha: repo.currentTreeSha, planHash: proof.planHash, requiredChecks: checks.map((x) => x.name), terminalChecks: checks.map(({ name, state, link }) => ({ name, state, link })) } });
} catch (error) {
  if (/no checks reported/i.test(String(error))) output("REMOTE_EVIDENCE_PENDING", { remoteEvidence: { status: "PENDING", headSha: repo.currentHeadSha, treeSha: repo.currentTreeSha, planHash: plan().planHash, requiredChecks: [], terminalChecks: [] } }, 2);
  if (inaccessible(error)) output("EXTERNAL_DEPENDENCY", { detail: String(error).slice(0, 240) }, 3);
  output("REMOTE_EVIDENCE_FAILED", { code: "REMOTE_EVIDENCE_QUERY_FAILED", detail: String(error).slice(0, 240) }, 2);
}
