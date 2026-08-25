import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const graphifyBin = process.env.ZEROGRAPH_GRAPHIFY_BIN ?? "graphify";
const run = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const head = run("rev-parse", "HEAD");
const output = resolve(root, "graphify-out");
const graph = resolve(output, "graph.json");
const stamp = resolve(output, ".crm-head");
const probe = spawnSync(graphifyBin, ["--version"], {
  cwd: root,
  encoding: "utf8",
});
if (probe.error || probe.status !== 0) {
  console.log("GRAPHIFY_UNAVAILABLE_TARGETED_SEARCH_REQUIRED");
  process.exit(0);
}
if (run("status", "--porcelain", "--untracked-files=no")) {
  console.log("GRAPHIFY_DIRTY_SOURCE_TARGETED_SEARCH_REQUIRED");
  process.exit(0);
}
if (
  existsSync(graph) &&
  existsSync(stamp) &&
  readFileSync(stamp, "utf8").trim() === head
) {
  console.log(`GRAPHIFY_FRESH:${head}`);
  process.exit(0);
}
execFileSync(graphifyBin, ["extract", ".", "--code-only"], {
  cwd: root,
  stdio: "inherit",
});
if (!existsSync(graph)) throw new Error("GRAPHIFY_EXTRACTION_GRAPH_MISSING");
mkdirSync(output, { recursive: true });
writeFileSync(stamp, `${head}\n`);
console.log(`GRAPHIFY_SYNCED:${head}`);
