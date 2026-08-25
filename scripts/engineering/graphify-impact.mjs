import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  args = process.argv.slice(2),
  index = args.indexOf("--task"),
  task = index < 0 ? "" : (args[index + 1] ?? ""),
  intent = (
    task
      .normalize("NFKC")
      .toLowerCase()
      .match(/[a-z0-9_]+/g) ?? []
  )
    .slice(0, 20)
    .join(" "),
  env = { ...process.env, GRAPHIFY_QUERY_LOG_DISABLE: "1" },
  graphifyBin = process.env.ZEROGRAPH_GRAPHIFY_BIN ?? "graphify";
if (!intent) {
  console.error("CONTEXT_AMBIGUOUS");
  process.exit(2);
}
const semantic = spawnSync(
  "node",
  ["scripts/engineering/context.mjs", "--task", task],
  { cwd: root, encoding: "utf8", env },
);
if (semantic.status !== 0) {
  process.stderr.write(semantic.stderr);
  process.exit(semantic.status || 1);
}
const context = JSON.parse(semantic.stdout),
  sync = spawnSync("node", ["scripts/engineering/graphify-sync.mjs"], {
    cwd: root,
    encoding: "utf8",
    env,
  }),
  syncState = sync.stdout.trim(),
  usable = /GRAPHIFY_(FRESH|SYNCED)/.test(syncState);
let structuralEvidence = {
  status: "SEMANTIC_FALLBACK",
  paths: context.candidatePaths,
  weight: "EXTRACTED",
};
if (usable) {
  const query = spawnSync(graphifyBin, ["query", intent, "--budget", "500"], {
    cwd: root,
    encoding: "utf8",
    env,
  });
  if (query.status === 0) {
    const paths = [
        ...new Set(
          query.stdout.match(/(?:src|scripts|e2e)\/[A-Za-z0-9_./-]+/g) ?? [],
        ),
      ].slice(0, 5),
      weight = /\bEXTRACTED\b/.test(query.stdout)
        ? "EXTRACTED"
        : /\bAMBIGUOUS\b/.test(query.stdout)
          ? "AMBIGUOUS"
          : "INFERRED";
    structuralEvidence = { status: "GRAPHIFY_BOUNDED", paths, weight };
  }
}
console.log(
  JSON.stringify({
    taskHash: context.taskHash,
    domains: context.domains,
    authorities: context.authorities,
    mustNotWriteAuthorities: context.mustNotWriteAuthorities,
    structuralEvidence,
    authoritySource: "SEMANTIC_REGISTRIES_ONLY",
    graphifyState: syncState,
  }),
);
