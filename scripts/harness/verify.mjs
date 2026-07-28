import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { args, artifacts, npmInvocation, runCommand } from "./cli.mjs";

const mode = args().mode ?? "full";
const taskFile = path.join(artifacts, "task-state.json");
const task = fs.existsSync(taskFile) ? JSON.parse(fs.readFileSync(taskFile, "utf8")) : { taskId: `verify-${mode}` };
const runDirectory = path.join(artifacts, "runs", task.taskId);
const commands = mode === "quick"
  ? [
      npmInvocation("run", "harness:scope"),
      npmInvocation("run", "harness:architecture"),
      npmInvocation("run", "harness:security"),
      npmInvocation("run", "harness:migrations"),
      npmInvocation("test", "--", "--runInBand"),
      npmInvocation("exec", "tsc", "--", "--noEmit")
    ]
  : mode === "ci" ? [
      npmInvocation("run", "harness:self-test"),
      npmInvocation("run", "harness:architecture"),
      npmInvocation("run", "harness:security"),
      npmInvocation("run", "harness:migrations"),
      npmInvocation("run", "harness:sql"),
      npmInvocation("run", "harness:scope"),
      npmInvocation("run", "lint"),
      npmInvocation("test", "--", "--runInBand"),
      npmInvocation("run", "build"),
      ["git", ["diff", "--check", `${task.baseCommit}...HEAD`]]
    ] : [
      npmInvocation("run", "lint"),
      npmInvocation("run", "harness:architecture"),
      npmInvocation("run", "harness:security"),
      npmInvocation("run", "harness:migrations"),
      npmInvocation("run", "harness:sql"),
      npmInvocation("test", "--", "--runInBand"),
      npmInvocation("run", "test:e2e:list"),
      npmInvocation("run", "build"),
      ["git", ["diff", "--check", task.baseCommit ?? "HEAD"]]
    ];
if (mode === "quick" && !fs.existsSync(taskFile)) commands.shift();
const results = [];
for (let index = 0; index < commands.length; index += 1) {
  const [command, commandArgs] = commands[index];
  const result = await runCommand(command, commandArgs, runDirectory, `${mode}-${String(index + 1).padStart(2, "0")}`);
  results.push(result);
  console.log(`${result.status} ${result.exitCode} ${result.command}`);
  if (result.exitCode !== 0) break;
}
fs.mkdirSync(runDirectory, { recursive: true });
fs.writeFileSync(path.join(runDirectory, "evidence.json"), `${JSON.stringify(results, null, 2)}\n`);
if (mode === "ci") {
  const quickLabels = new Set(commands.slice(1, 6).map(([command, commandArgs]) => [command, ...commandArgs].join(" ")));
  fs.writeFileSync(path.join(artifacts, "performance-evidence.json"), `${JSON.stringify({
    node: process.version,
    npm: process.env.npm_execpath ? execFileSync(process.execPath, [process.env.npm_execpath, "--version"], { encoding: "utf8" }).trim() : "unknown",
    quickDurationMs: results.filter((item) => quickLabels.has(item.command)).reduce((sum, item) => sum + item.durationMs, 0),
    fullDurationMs: results.reduce((sum, item) => sum + item.durationMs, 0)
  }, null, 2)}\n`);
}
if (results.some((result) => result.exitCode !== 0)) process.exit(1);
