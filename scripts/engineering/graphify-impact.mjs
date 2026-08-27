import { spawnSync } from "node:child_process";
import { resolveContext } from "./context.mjs";
import { parseArgs, root, safeEnvironment } from "./kernel-lib.mjs";
const task = parseArgs().value("--task", ""), context = resolveContext({ task });
if (!task) { console.error("SCOPE_AMBIGUOUS"); process.exit(2); }
const fallback = { status: "TARGETED_SOURCE_FALLBACK", paths: context.candidatePaths.map((item) => item.path), grantsAuthority: false };
if (context.status === "RESOLVED") {
  console.log(JSON.stringify({ taskHash: context.taskHash, structuralEvidence: fallback, authoritySource: "CURRENT_REGISTRIES" }));
  process.exit(0);
}
const environment = safeEnvironment(), executable = process.env.GRAPHIFY_BIN ?? "graphify", probe = spawnSync(executable, ["--version"], { cwd: root, encoding: "utf8", env: environment });
if (probe.status !== 0) {
  console.log(JSON.stringify({ taskHash: context.taskHash, structuralEvidence: fallback, authoritySource: "CURRENT_REGISTRIES" }));
  process.exit(0);
}
const intent = (task.toLowerCase().match(/[a-z0-9_]+/g) ?? []).slice(0, 20).join(" ");
const query = spawnSync(executable, ["query", intent, "--budget", "500"], { cwd: root, encoding: "utf8", env: { ...environment, GRAPHIFY_QUERY_LOG_DISABLE: "1" } });
const paths = query.status === 0 ? [...new Set(query.stdout.match(/(?:src|scripts|e2e)\/[A-Za-z0-9_./-]+/g) ?? [])].slice(0, 5) : fallback.paths;
console.log(JSON.stringify({ taskHash: context.taskHash, structuralEvidence: { status: query.status === 0 ? "GRAPHIFY_BOUNDED" : fallback.status, paths, grantsAuthority: false }, authoritySource: "CURRENT_REGISTRIES" }));
