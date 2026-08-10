import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
export const manifestPath = resolve(root, ".harness/task.json");
export const configPath = resolve(root, "harness.config.json");
export const normalize = (value) => value.replaceAll("\\", "/").replace(/^\.\//, "");
export function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
export function manifest(required = true) {
  if (!existsSync(manifestPath)) {
    if (required) throw new Error("Missing .harness/task.json. Create it before implementation; it is runtime-only and must not be committed.");
    return null;
  }
  const value = readJson(manifestPath);
  for (const key of ["task", "risk", "domains", "allowedPaths", "protectedDomains", "productionDataMutation", "schemaChange", "acceptance"]) {
    if (!(key in value)) throw new Error(`Task manifest is missing ${key}.`);
  }
  if (!["R0", "R1", "R2", "R3"].includes(value.risk)) throw new Error(`Invalid risk: ${value.risk}`);
  return value;
}
export function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}
export function changedPaths() {
  const values = new Set();
  const comparison = process.env.GITHUB_BASE_REF ? [`origin/${process.env.GITHUB_BASE_REF}...HEAD`] : ["HEAD"];
  for (const args of [["diff", "--name-only", "--diff-filter=ACMR", ...comparison], ["ls-files", "--others", "--exclude-standard"]]) {
    const output = git(args);
    for (const line of output.split(/\r?\n/).filter(Boolean)) values.add(normalize(line));
  }
  return [...values].sort();
}
export function baselineRef() { return process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD"; }
export function matchesPath(file, configured) {
  const target = normalize(configured);
  return target.endsWith("/") ? file.startsWith(target) : file === target || file.startsWith(`${target}/`);
}
export function run(command, args, { allowFailure = false, env } = {}) {
  const useNpmCli = command === "npm" && process.env.npm_execpath;
  const executable = useNpmCli ? process.execPath : command;
  const commandArgs = useNpmCli ? [process.env.npm_execpath, ...args] : args;
  const result = spawnSync(executable, commandArgs, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) process.exit(result.status ?? 1);
  return result.status ?? 1;
}
export function rel(path) { return normalize(relative(root, path)); }
export function logList(title, items) { console.log(`${title}:`); for (const item of items) console.log(`- ${item}`); }
