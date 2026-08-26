import { execFileSync } from "node:child_process";
import { loadState, repositoryState, root, saveState } from "./hooks/state.mjs";
const run = (args) => execFileSync("gh", args, { cwd: root, encoding: "utf8" }).trim();
const session = process.env.ZEROGRAPH_SESSION_ID ?? "unknown", repo = repositoryState(), fail = (code, detail) => { saveState({ ...loadState(session), ...repo, remoteEvidence: { status: "FAIL", code, detail } }); console.log(JSON.stringify({ status: "REMOTE_EVIDENCE_FAILED", code, detail })); process.exit(2); };
try {
  const pr = JSON.parse(run(["pr", "view", "--json", "number,headRefOid"]));
  if (pr.headRefOid !== repo.currentHeadSha) fail("PR_HEAD_STALE", pr.headRefOid);
  let checks = JSON.parse(run(["pr", "checks", String(pr.number), "--json", "name,state,link,description"]));
  if (checks.some((x) => ["PENDING", "QUEUED", "IN_PROGRESS"].includes(x.state))) {
    run(["pr", "checks", String(pr.number), "--watch", "--interval", "10"]);
    checks = JSON.parse(run(["pr", "checks", String(pr.number), "--json", "name,state,link,description"]));
  }
  const failed = checks.filter((x) => x.state !== "SUCCESS");
  if (failed.length) fail("REQUIRED_CHECK_FAILED", failed.map((x) => ({ name: x.name, state: x.state, link: x.link, description: String(x.description ?? "").slice(0, 240) })));
  saveState({ ...loadState(session), ...repo, remoteEvidence: { status: "PASS", headSha: repo.currentHeadSha, treeSha: repo.currentTreeSha, checks: checks.map((x) => x.name) } });
  console.log(JSON.stringify({ status: "REMOTE_EVIDENCE_PASS", headSha: repo.currentHeadSha }));
} catch (error) { if (String(error.message).includes("REQUIRED_CHECK_FAILED")) throw error; console.log(JSON.stringify({ status: "EXTERNAL_DEPENDENCY", detail: String(error.message).slice(0, 240) })); process.exit(3); }
