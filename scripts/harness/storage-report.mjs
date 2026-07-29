import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVE_EXTENSIONS = new Set([".zip", ".7z", ".rar", ".tar", ".gz", ".bak", ".dump"]);
const BINARY_EXTENSIONS = new Set([".exe", ".dll", ".dmg", ".iso"]);
const ARTIFACT_WARNING_BYTES = 200 * 1024 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function findTrackedArchiveViolations(files) {
  return files.filter((file) => ARCHIVE_EXTENSIONS.has(path.extname(file).toLowerCase())
    || BINARY_EXTENSIONS.has(path.extname(file).toLowerCase()));
}

async function directorySize(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    let bytes = 0;
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      bytes += entry.isDirectory() ? await directorySize(fullPath) : (await stat(fullPath)).size;
    }
    return bytes;
  } catch {
    return 0;
  }
}

async function staleArtifactCount(directory, now = Date.now()) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) count += await staleArtifactCount(fullPath, now);
      else if (now - (await stat(fullPath)).mtimeMs > RETENTION_MS) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

const formatMiB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

export async function createStorageReport(root = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
  let trackedBytes = 0;
  for (const file of tracked) {
    try { trackedBytes += (await stat(path.join(root, file))).size; } catch { /* deleted working-tree file */ }
  }
  const worktreeCount = git("worktree", "list", "--porcelain").split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length;
  const artifactBytes = await directorySize(path.join(root, ".codex-artifacts"));
  return {
    trackedBytes,
    artifactBytes,
    nextBytes: await directorySize(path.join(root, ".next")),
    playwrightBytes: (await directorySize(path.join(root, "test-results"))) + (await directorySize(path.join(root, "playwright-report"))),
    nodeModulesBytes: await directorySize(path.join(root, "node_modules")),
    worktreeCount,
    archiveViolations: findTrackedArchiveViolations(tracked),
    staleArtifactFiles: await staleArtifactCount(path.join(root, ".codex-artifacts")),
  };
}

async function main() {
  const report = await createStorageReport();
  console.log(`Tracked repository: ${formatMiB(report.trackedBytes)}`);
  console.log(`.codex-artifacts: ${formatMiB(report.artifactBytes)}`);
  console.log(`.next: ${formatMiB(report.nextBytes)}`);
  console.log(`Playwright output: ${formatMiB(report.playwrightBytes)}`);
  console.log(`node_modules: ${formatMiB(report.nodeModulesBytes)} (informational; never deleted automatically)`);
  console.log(`Active worktrees: ${report.worktreeCount}`);
  console.log(`Committed binary/archive violations: ${report.archiveViolations.length ? report.archiveViolations.join(", ") : "none"}`);
  if (report.artifactBytes > ARTIFACT_WARNING_BYTES) console.warn("WARNING: .codex-artifacts exceeds 200 MB.");
  if (report.staleArtifactFiles) console.warn(`WARNING: ${report.staleArtifactFiles} .codex-artifacts file(s) exceed 7-day retention.`);
  if (report.worktreeCount > 2) console.warn("WARNING: more than two active project worktrees.");
  if (report.archiveViolations.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
