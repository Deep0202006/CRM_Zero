import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

export const root = process.cwd();
export const artifacts = path.join(root, ".codex-artifacts");
export const excluded = new Set([".git", ".next", "node_modules", "coverage", "out", "build", ".codex-artifacts", ".harness-cache"]);
export const normalize = (value) => value.split(path.sep).join("/");
export const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
export const writeJson = (file, value) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};
export const args = (values = process.argv.slice(2)) => {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    const key = values[index].slice(2);
    result[key] = values[index + 1]?.startsWith("--") ? true : (values[++index] ?? true);
  }
  return result;
};
export const git = (...values) => execFileSync("git", values, { cwd: root, encoding: "utf8" }).trim();
export const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export const listFiles = (directory = ".") => {
  const start = path.join(root, directory);
  if (!fs.existsSync(start)) return [];
  const result = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else result.push(normalize(path.relative(root, absolute)));
    }
  };
  visit(start);
  return result;
};
export const globMatch = (file, pattern) => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`).test(normalize(file));
};
export const loadAreas = () => listFiles("harness/areas").filter((file) => file.endsWith(".json")).map((file) => readJson(file));
export const changedFiles = (base) => {
  let mergeBase = base;
  if (!mergeBase) {
    const taskFile = path.join(artifacts, "task-state.json");
    if (fs.existsSync(taskFile)) mergeBase = JSON.parse(fs.readFileSync(taskFile, "utf8")).baseCommit;
  }
  if (!mergeBase) {
    try { mergeBase = git("merge-base", "HEAD", git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")); }
    catch { mergeBase = git("rev-parse", "HEAD"); }
  }
  const committed = git("diff", "--name-only", `${mergeBase}...HEAD`).split(/\r?\n/);
  const working = git("diff", "--name-only").split(/\r?\n/);
  const untracked = git("ls-files", "--others", "--exclude-standard").split(/\r?\n/);
  return [...new Set([...committed, ...working, ...untracked].filter(Boolean).map(normalize))].sort();
};
export const taskState = () => readJson(".codex-artifacts/task-state.json");
export const countWords = (text) => (text.trim().match(/\S+/g) ?? []).length;
export const safeRead = (file) => {
  if (/\.env(?:\.|$)/.test(path.basename(file)) || /\.(zip|png|jpe?g|gif|pdf|ico|woff2?)$/i.test(file)) return "";
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 60 * 1024) return "";
  return fs.readFileSync(absolute, "utf8");
};
export const runCommand = (command, commandArgs, runDirectory, label) => new Promise((resolve) => {
  fs.mkdirSync(runDirectory, { recursive: true });
  const stdoutPath = path.join(runDirectory, `${label}.stdout.log`);
  const stderrPath = path.join(runDirectory, `${label}.stderr.log`);
  const stdout = fs.createWriteStream(stdoutPath);
  const stderr = fs.createWriteStream(stderrPath);
  const startedAt = new Date();
  const child = spawn(command, commandArgs, { cwd: root, shell: false, env: process.env });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.on("close", (code) => {
    const finishedAt = new Date();
    stdout.end();
    stderr.end();
    resolve({
      command: [command, ...commandArgs].join(" "),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode: code ?? 1,
      stdoutPath: normalize(path.relative(root, stdoutPath)),
      stderrPath: normalize(path.relative(root, stderrPath)),
      status: code === 0 ? "PASSED" : "FAILED"
    });
  });
});
export const npmInvocation = (...commandArgs) => [
  process.execPath,
  [process.env.npm_execpath ?? path.join(root, "node_modules", "npm", "bin", "npm-cli.js"), ...commandArgs]
];
