import fs from "node:fs";
import path from "node:path";
import { args, artifacts, changedFiles, countWords, git, readJson } from "./cli.mjs";

const options = args();
const state = readJson(".codex-artifacts/task-state.json");
const evidenceFile = path.join(artifacts, "runs", state.taskId, "evidence.json");
const evidence = fs.existsSync(evidenceFile) ? JSON.parse(fs.readFileSync(evidenceFile, "utf8")) : [];
const files = changedFiles(state.baseCommit);
const evidenceLines = evidence.map((item) => `- ${item.status} exit ${item.exitCode}: \`${item.command}\` ([stdout](${item.stdoutPath}), [stderr](${item.stderrPath}))`);
const skipped = evidence.filter((item) => item.status === "SKIPPED");
const handoff = Boolean(options.handoff);
const lines = handoff ? [
  "# Implementation handoff", "## Status", evidence.some((item) => item.exitCode !== 0) ? "BLOCKED" : "READY FOR REVIEW",
  "## Objective", state.taskDescription, "## Files changed", ...files.map((file) => `- ${file}`),
  "## Behavior preserved", state.uiChangeExpected ? "UI change declared in task capsule." : "Existing product UI and behavior preserved.",
  "## Database changes", state.databaseChangeExpected ? "Database change declared; inspect migration evidence." : "None declared.",
  "## Security changes", "See security evidence and affected invariants.",
  "## Tests and exact exit codes", ...evidenceLines,
  "## Skipped gates", ...(skipped.length ? skipped.map((item) => `- ${item.command}`) : ["- None recorded"]),
  "## Manual operator steps", ...state.manualHumanGates.map((item) => `- ${item}`),
  "## Git state", `Branch ${git("branch", "--show-current")} at ${git("rev-parse", "HEAD")}.`,
  "## Remaining blocker", evidence.some((item) => item.exitCode !== 0) ? "Resolve failed evidence." : "Human gates only."
] : [
  "# Detached review pack", "## Task intent", state.taskDescription,
  "## Branch and commit", `${git("branch", "--show-current")} at ${git("rev-parse", "HEAD")}`,
  "## Changed files", ...files.map((file) => `- ${file}`),
  "## Architectural invariants touched", ...state.affectedInvariants.map((item) => `- ${item}`),
  "## Database objects touched", state.databaseChangeExpected ? "Inspect migration and RPC contract diffs." : "None declared.",
  "## Security implications", `Risk: ${state.riskLevel}. Security evidence is mandatory.`,
  "## Tests run", ...evidenceLines,
  "## Skipped tests", ...(skipped.length ? skipped.map((item) => `- ${item.command}`) : ["- None recorded"]),
  "## Unresolved risks and human gates", ...state.manualHumanGates.map((item) => `- ${item}`),
  "## Rollback strategy", "Revert the scoped commits; do not reverse applied SQL without an approved forward repair.",
  "## Diff hotspots", ...files.slice(0, 12).map((file) => `- ${file}`)
];
const max = handoff ? 600 : 800;
let output = `${lines.join("\n")}\n`;
if (countWords(output) > max) throw new Error(`Generated ${handoff ? "handoff" : "review pack"} exceeds ${max} words.`);
fs.writeFileSync(path.join(artifacts, handoff ? "implementation-handoff.md" : "review-pack.md"), output);
console.log(`${handoff ? "Handoff" : "Review pack"} generated (${countWords(output)} words).`);
