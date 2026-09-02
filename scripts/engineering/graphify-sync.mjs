import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { safeEnvironment } from "./kernel-lib.mjs";

const root = resolve(import.meta.dirname, "../..");
const graphifyBin = process.env.GRAPHIFY_BIN ?? "graphify";
const environment = safeEnvironment();
const run = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const head = run("rev-parse", "HEAD");
const tree = run("rev-parse", "HEAD^{tree}");
const output = resolve(root, "graphify-out");
const graph = resolve(output, "graph.json");
const stamp = resolve(output, ".crm-tree");
const common = run("rev-parse", "--path-format=absolute", "--git-common-dir");
const snapshotDirectory = resolve(common, "zd-os/graphify/trees", tree);
const snapshot = resolve(snapshotDirectory, "graph.json");
const probe = spawnSync(graphifyBin, ["--version"], {
  cwd: root,
  encoding: "utf8",
  env: environment,
});
if (probe.error || probe.status !== 0) {
  console.log("GRAPHIFY_UNAVAILABLE_TARGETED_SEARCH_REQUIRED");
  process.exit(0);
}
if (run("status", "--porcelain", "--untracked-files=no")) {
  console.log("GRAPHIFY_DIRTY_SOURCE_TARGETED_SEARCH_REQUIRED");
  process.exit(0);
}
if (existsSync(graph) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === tree) {
  console.log(`GRAPHIFY_FRESH:${tree}`);
  process.exit(0);
}
if (existsSync(snapshot)) {
  mkdirSync(output, { recursive: true });
  copyFileSync(snapshot, graph);
  writeFileSync(stamp, `${tree}\n`);
  console.log(`GRAPHIFY_SHARED_CACHE_HIT:${tree}`);
  process.exit(0);
}
execFileSync(graphifyBin, ["extract", ".", "--code-only"], {
  cwd: root,
  stdio: "inherit",
  env: environment,
});
if (!existsSync(graph)) throw new Error("GRAPHIFY_EXTRACTION_GRAPH_MISSING");
mkdirSync(output, { recursive: true });
mkdirSync(snapshotDirectory, { recursive: true });
const temporary = `${snapshot}.tmp-${process.pid}`;
copyFileSync(graph, temporary);
if (existsSync(snapshot)) unlinkSync(temporary); else renameSync(temporary, snapshot);
writeFileSync(stamp, `${tree}\n`);
console.log(`GRAPHIFY_SYNCED:${head}:${tree}`);
