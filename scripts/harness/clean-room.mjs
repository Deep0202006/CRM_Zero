import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { artifacts, normalize, root } from "./cli.mjs";

const nodeVersion = fs.readFileSync(path.join(root, ".node-version"), "utf8").trim();
if (process.version !== `v${nodeVersion}`) {
  console.error(`Clean-room requires Node v${nodeVersion}; current runtime is ${process.version}.`);
  process.exit(2);
}
const taskId = `clean-room-${Date.now()}`;
const logDirectory = path.join(artifacts, "clean-room", taskId);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "zerodata-clean-room-"));
const checkout = path.join(temporaryRoot, "checkout");
fs.mkdirSync(logDirectory, { recursive: true });
const manifest = [];
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required.");
const run = (label, command, commandArgs) => {
  const started = Date.now();
  const result = spawnSync(command, commandArgs, { cwd: checkout, encoding: "utf8", env: process.env, shell: false });
  fs.writeFileSync(path.join(logDirectory, `${label}.stdout.log`), result.stdout ?? "");
  fs.writeFileSync(path.join(logDirectory, `${label}.stderr.log`), result.stderr ?? "");
  manifest.push({ label, command: [command, ...commandArgs].join(" "), durationMs: Date.now() - started, exitCode: result.status ?? 1 });
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status ?? 1}. Logs: ${normalize(path.relative(root, logDirectory))}`);
};
let failure;
try {
  execFileSync("git", ["worktree", "add", "--detach", checkout, "HEAD"], { cwd: root, stdio: "pipe" });
  const forbidden = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: checkout, encoding: "utf8" }).trim();
  if (forbidden) throw new Error(`Clean checkout unexpectedly contains files:\n${forbidden}`);
  if (fs.existsSync(path.join(checkout, ".codex-artifacts"))) throw new Error("Ignored local artifacts leaked into clean checkout.");
  run("npm-ci", process.execPath, [npmCli, "ci"]);
  for (const [label, script] of [
    ["self-test", "harness:self-test"], ["architecture", "harness:architecture"],
    ["security", "harness:security"], ["migrations", "harness:migrations"],
    ["sql", "harness:sql"], ["lint", "lint"], ["unit", "test"], ["build", "build"]
  ]) run(label, process.execPath, [npmCli, "run", script, ...(script === "test" ? ["--", "--runInBand"] : [])]);
} catch (error) {
  failure = error;
} finally {
  fs.writeFileSync(path.join(logDirectory, "manifest.json"), `${JSON.stringify({
    node: process.version,
    npm: execFileSync(process.execPath, [npmCli, "--version"], { encoding: "utf8" }).trim(),
    checkoutContainedArtifacts: false,
    commands: manifest
  }, null, 2)}\n`);
  try { execFileSync("git", ["worktree", "remove", "--force", checkout], { cwd: root, stdio: "pipe" }); } catch {}
  try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch {}
}
if (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exit(1);
}
console.log(`Clean-room passed with Node ${process.version}; evidence: ${normalize(path.relative(root, logDirectory))}`);
