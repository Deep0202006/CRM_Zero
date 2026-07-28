import fs from "node:fs";
import path from "node:path";
import { args, countWords, git, listFiles, loadAreas, normalize, readJson, root, safeRead, writeJson } from "./cli.mjs";

const options = args();
const statePath = path.join(root, ".codex-artifacts/task-state.json");
const state = fs.existsSync(statePath) ? readJson(".codex-artifacts/task-state.json") : null;
const areaName = options.area ?? state?.area;
const description = options.task ?? state?.taskDescription;
const area = loadAreas().find((candidate) => candidate.name === areaName);
if (!area || !description) {
  if (import.meta.url === `file:///${normalize(process.argv[1])}`) console.error("Create a task or pass --area and --task.");
  exportStatus("invalid");
} else {
  const paths = ["AGENTS.md", `harness/areas/${area.name}.json`, ...area.relatedDocs, ...area.entrypoints.filter((item) => !item.includes("*"))];
  const unique = [...new Set(paths)].filter((file) => fs.existsSync(path.join(root, file))).slice(0, 20);
  const sections = [
    "# Deterministic task context",
    `Task: ${description}`,
    `Area: ${area.name} (${area.riskLevel})`,
    "## Read first", ...unique.map((file) => `- ${file}`),
    "## Do not read initially", "- node_modules, build output, environment files, binaries, old repair packages, unrelated routes",
    "## Invariants", ...area.invariants.map((item) => `- ${item}`),
    "## Affected contracts", ...area.databaseObjects.map((item) => `- ${item}`),
    "## Required tests", ...area.requiredTests.map((item) => `- ${item}`),
    "## Allowed paths", ...area.allowedDefaultPaths.map((item) => `- ${item}`),
    "## Human gates", ...(area.manualGates.length ? area.manualGates : ["- None declared"]),
    "## Bounded excerpts"
  ];
  let filesIncluded = 0;
  for (const file of unique) {
    const text = safeRead(file);
    if (!text) continue;
    const excerpt = text.split(/\r?\n/).slice(0, 80).join("\n");
    const candidate = [...sections, `### ${file}`, "```", excerpt, "```"].join("\n");
    if (Buffer.byteLength(candidate) > 60 * 1024 || countWords(candidate) > 1450) break;
    sections.push(`### ${file}`, "```", excerpt, "```");
    filesIncluded += 1;
  }
  const tree = listFiles().filter((file) => file.split("/").length <= 3).slice(0, 120);
  sections.push("## Repository tree (depth 3)", ...tree.map((file) => `- ${file}`));
  const recent = git("log", "-5", "--oneline");
  sections.push("## Recent commits", "```", recent, "```", "## Unresolved questions", "- Confirm whether scope, database impact, and UI impact inferred in task-state are correct before editing.");
  while (countWords(sections.join("\n")) > 1500) sections.splice(sections.findIndex((item) => item === "## Repository tree (depth 3)") + 1, 1);
  const output = `${sections.join("\n")}\n`;
  fs.mkdirSync(path.join(root, ".codex-artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, ".codex-artifacts/context.md"), output);
  writeJson(".codex-artifacts/context-metadata.json", { words: countWords(output), bytes: Buffer.byteLength(output), filesIncluded, deterministicOrdering: true });
  exportStatus("generated");
}
function exportStatus(value) { globalThis.__contextStatus = value; }
export const status = globalThis.__contextStatus;
