import { execFileSync } from "node:child_process";
import { readdir, rm, stat } from "node:fs/promises";
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

async function existingDirectory(directory) {
  try { return (await stat(directory)).isDirectory(); } catch { return false; }
}

async function oldGeneratedDirectory(directory, now, minimumAgeMs = 24 * 60 * 60 * 1000) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    let newest = (await stat(directory)).mtimeMs;
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!await oldGeneratedDirectory(candidate, now, minimumAgeMs)) return false;
      } else {
        newest = Math.max(newest, (await stat(candidate)).mtimeMs);
      }
    }
    return now - newest > minimumAgeMs;
  } catch {
    return false;
  }
}

async function expiredArtifactFiles(directory, now) {
  const files = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await expiredArtifactFiles(fullPath, now));
      else if (now - (await stat(fullPath)).mtimeMs > RETENTION_MS) files.push(fullPath);
    }
  } catch { /* absent artifact directory */ }
  return files;
}

export async function collectGeneratedCleanupCandidates(root = process.cwd(), now = Date.now()) {
  const resolvedRoot = path.resolve(root);
  const directories = [];
  const nextPath = path.join(resolvedRoot, ".next");
  if (await oldGeneratedDirectory(nextPath, now)) directories.push(nextPath);
  for (const name of ["test-results", "playwright-report"]) {
    const candidate = path.join(resolvedRoot, name);
    if (await existingDirectory(candidate)) directories.push(candidate);
  }
  return {
    directories,
    expiredArtifacts: await expiredArtifactFiles(path.join(resolvedRoot, ".codex-artifacts"), now),
  };
}

async function removeEmptyHarnessFolders(root) {
  for (const name of [".harness-cache", "tmp"]) {
    const candidate = path.join(root, name);
    try {
      if ((await readdir(candidate)).length === 0) {
        console.log(`DELETE empty generated folder: ${candidate}`);
        await rm(candidate, { recursive: false });
      }
    } catch { /* absent or non-empty */ }
  }
}

async function removeEmptyArtifactFolders(directory, artifactRoot) {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await removeEmptyArtifactFolders(path.join(directory, entry.name), artifactRoot);
    }
    if (directory !== artifactRoot && (await readdir(directory)).length === 0) {
      console.log(`DELETE empty harness artifact folder: ${directory}`);
      await rm(directory, { recursive: false });
    }
  } catch { /* absent or concurrently removed */ }
}

async function cleanGenerated(root) {
  const resolvedRoot = path.resolve(root);
  const candidates = await collectGeneratedCleanupCandidates(resolvedRoot);
  for (const candidate of candidates.directories) {
    console.log(`DELETE generated directory: ${candidate}`);
    await rm(candidate, { recursive: true });
  }
  for (const candidate of candidates.expiredArtifacts) {
    console.log(`DELETE expired harness artifact: ${candidate}`);
    await rm(candidate);
  }
  await removeEmptyArtifactFolders(path.join(resolvedRoot, ".codex-artifacts"), path.join(resolvedRoot, ".codex-artifacts"));
  await removeEmptyHarnessFolders(resolvedRoot);
  const prunePreview = execFileSync("git", ["worktree", "prune", "--dry-run", "--verbose"], {
    cwd: resolvedRoot,
    encoding: "utf8",
  }).trim();
  console.log(`Git worktree administrative prune: ${prunePreview || "no stale references"}`);
  execFileSync("git", ["worktree", "prune"], { cwd: resolvedRoot, stdio: "inherit" });
}

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
  if (process.argv.includes("--clean-generated")) await cleanGenerated(process.cwd());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
