const graphOnlyPatterns = [
  /^\.crm-engineering\//,
  /^tools\/crm-graph\//,
  /^docs\/engineering-graph\//,
  /^AGENTS\.md$/,
  /^CRM_CONTEXT\.md$/
];

export function classifyChangedPaths(paths) {
  const normalized=paths.map(value=>value.trim().replace(/\\/g,"/")).filter(Boolean);
  if (normalized.length === 0) return "full";
  if (normalized.some(value=>value.startsWith(".github/workflows/"))) return "full";
  return normalized.every(value=>graphOnlyPatterns.some(pattern=>pattern.test(value))) ? "graph_only" : "full";
}

const pathsIndex=process.argv.indexOf("--paths-json");
if (pathsIndex >= 0) {
  const paths=JSON.parse(process.argv[pathsIndex+1] ?? "[]");
  process.stdout.write(classifyChangedPaths(paths));
} else if (process.argv.includes("--base") && process.argv.includes("--head")) {
  const base=process.argv[process.argv.indexOf("--base")+1];
  const head=process.argv[process.argv.indexOf("--head")+1];
  const result=spawnSync("git",["diff","--name-only","-z",base,head],{encoding:"utf8",shell:false});
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Unable to classify changed paths.\n");
    process.exit(result.status ?? 1);
  }
  process.stdout.write(classifyChangedPaths(result.stdout.split("\0")));
}
import { spawnSync } from "node:child_process";
