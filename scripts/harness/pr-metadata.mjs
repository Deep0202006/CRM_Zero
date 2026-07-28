import fs from "node:fs";
import path from "node:path";
import { artifacts, writeJson } from "./cli.mjs";

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || !fs.existsSync(eventPath)) {
  console.error("GITHUB_EVENT_PATH is required for PR metadata validation.");
  process.exit(2);
}
const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
const body = event.pull_request?.body ?? "";
const match = body.match(/<!-- zerodata-harness\s*([\s\S]*?)\s*-->/);
if (!match) {
  console.error("PR body is missing the zerodata-harness metadata block.");
  process.exit(1);
}
let metadata;
try { metadata = JSON.parse(match[1]); } catch {
  console.error("zerodata-harness metadata is not valid JSON.");
  process.exit(1);
}
const keys = ["taskId", "area", "riskLevel", "databaseChange", "uiChange", "allowedPaths", "approvedExceptions"];
if (Object.keys(metadata).sort().join() !== [...keys].sort().join()) {
  console.error("zerodata-harness metadata has missing or unknown fields.");
  process.exit(1);
}
if (!/^[a-z0-9-]{3,80}$/.test(metadata.taskId) || !/^[a-z0-9-]+$/.test(metadata.area) ||
    !["low", "medium", "high", "critical"].includes(metadata.riskLevel) ||
    typeof metadata.databaseChange !== "boolean" || typeof metadata.uiChange !== "boolean" ||
    !Array.isArray(metadata.allowedPaths) || !metadata.allowedPaths.length ||
    !metadata.allowedPaths.every((item) => typeof item === "string" && item.length <= 180) ||
    !Array.isArray(metadata.approvedExceptions) || !metadata.approvedExceptions.every((item) => typeof item === "string")) {
  console.error("zerodata-harness metadata failed strict schema validation.");
  process.exit(1);
}
fs.mkdirSync(artifacts, { recursive: true });
const baseCommit = event.pull_request?.base?.sha;
writeJson(".codex-artifacts/task-state.json", {
  ...metadata,
  taskDescription: "Reconstructed from pull request metadata",
  baseBranch: event.pull_request?.base?.ref,
  baseCommit,
  workingBranch: event.pull_request?.head?.ref,
  databaseChangeExpected: metadata.databaseChange,
  uiChangeExpected: metadata.uiChange,
  explicitlyApprovedAdditionalPaths: metadata.approvedExceptions,
  scopeJustification: metadata.approvedExceptions.length ? "Approved in PR metadata." : "",
  affectedInvariants: [],
  expectedEntrypoints: [],
  expectedTests: [],
  manualHumanGates: [],
  status: "CI_VALIDATION",
  startedAt: new Date().toISOString()
});
writeJson(".codex-artifacts/change-boundary.json", {
  allowedPaths: metadata.allowedPaths,
  forbiddenPaths: ["node_modules/**", ".next/**", ".env*", ".codex-artifacts/**"],
  explicitlyApprovedAdditionalPaths: metadata.approvedExceptions,
  expectedMigrationBehavior: metadata.databaseChange ? "forward-only" : "none",
  expectedUiBehavior: metadata.uiChange ? "declared" : "preserve",
  expectedDatabaseBehavior: metadata.databaseChange ? "declared" : "none"
});
console.log(`PR metadata validated for ${metadata.taskId}.`);
