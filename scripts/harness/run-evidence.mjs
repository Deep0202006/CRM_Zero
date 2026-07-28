import fs from "node:fs";
import path from "node:path";
import { args, artifacts, runCommand } from "./cli.mjs";

const options = args();
const taskFile = path.join(artifacts, "task-state.json");
const task = fs.existsSync(taskFile) ? JSON.parse(fs.readFileSync(taskFile, "utf8")) : { taskId: "ad-hoc" };
const commands = options.commands ? JSON.parse(options.commands) : [];
const runDirectory = path.join(artifacts, "runs", task.taskId);
const results = [];
for (let index = 0; index < commands.length; index += 1) {
  const [command, ...commandArgs] = commands[index];
  results.push(await runCommand(command, commandArgs, runDirectory, String(index + 1).padStart(2, "0")));
}
fs.mkdirSync(runDirectory, { recursive: true });
fs.writeFileSync(path.join(runDirectory, "evidence.json"), `${JSON.stringify(results, null, 2)}\n`);
for (const result of results) console.log(`${result.status} ${result.exitCode} ${result.command}`);
if (results.some((result) => result.exitCode !== 0)) process.exit(1);
