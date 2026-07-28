import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { args, artifacts, git, loadAreas, writeJson } from "./cli.mjs";

const options = args();
const area = loadAreas().find((candidate) => candidate.name === options.area);
if (!area || typeof options.task !== "string") {
  console.error("Usage: npm run harness:new -- --area <area> --task \"<description>\"");
  process.exit(2);
}
fs.mkdirSync(artifacts, { recursive: true });
const branch = git("branch", "--show-current");
const upstream = (() => { try { return git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); } catch { return branch; } })();
const baseCommit = git("merge-base", "HEAD", upstream);
const taskId = `${area.name}-${crypto.createHash("sha256").update(`${options.task}\n${baseCommit}`).digest("hex").slice(0, 10)}`;
const databaseExpected = /\b(database|migration|sql|rpc|rls|table|trigger)\b/i.test(options.task);
const uiExpected = /\b(ui|page|screen|layout|responsive|visual|frontend)\b/i.test(options.task);
writeJson(".codex-artifacts/task-state.json", {
  taskId, area: area.name, taskDescription: options.task, baseBranch: upstream,
  baseCommit, workingBranch: branch, riskLevel: area.riskLevel,
  affectedInvariants: area.invariants, expectedEntrypoints: area.entrypoints,
  expectedTests: area.requiredTests, databaseChangeExpected: databaseExpected,
  uiChangeExpected: uiExpected, manualHumanGates: area.manualGates,
  status: "created", startedAt: new Date().toISOString(),
  explicitlyApprovedAdditionalPaths: [], scopeJustification: ""
});
writeJson(".codex-artifacts/change-boundary.json", {
  allowedPaths: area.allowedDefaultPaths, forbiddenPaths: ["node_modules/**", ".next/**", ".env*", ".codex-artifacts/**"],
  explicitlyApprovedAdditionalPaths: [], expectedMigrationBehavior: databaseExpected ? "one new forward-only migration or declared current migration" : "none",
  expectedUiBehavior: uiExpected ? "declared scoped UI change" : "preserve current UI",
  expectedDatabaseBehavior: databaseExpected ? "declared contract change with tests" : "no database change"
});
const { status } = await import("./context-pack.mjs");
if (status !== "generated") process.exit(1);
console.log(`Created task capsule ${taskId}.`);
