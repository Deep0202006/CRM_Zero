import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function inspectRepo(cwd: string) {
  const top = path.resolve(git(cwd, ["rev-parse","--show-toplevel"]));
  const branch = git(cwd, ["branch","--show-current"]) || null;
  const head = git(cwd, ["rev-parse","HEAD"]);
  const status = git(cwd, ["status","--porcelain=v1","-z"]);
  const worktrees = git(cwd, ["worktree","list","--porcelain"]);
  return {
    top, branch, head, status, worktrees,
    dirtyHash: createHash("sha256").update(status).digest("hex")
  };
}

export function isAncestor(cwd: string, ancestor: string, descendant: string) {
  try {
    execFileSync("git", ["-C", cwd, "merge-base", "--is-ancestor", ancestor, descendant], { stdio:"ignore" });
    return true;
  } catch {
    return false;
  }
}

export function diffSnapshot(cwd: string) {
  const diff = git(cwd, ["diff","--binary","--no-ext-diff"]);
  const untracked = git(cwd, ["ls-files","--others","--exclude-standard"]);
  return {
    diff,
    untracked: untracked ? untracked.split(/\r?\n/).filter(Boolean) : [],
    hash: createHash("sha256")
      .update(diff)
      .update("\n--UNTRACKED--\n")
      .update(untracked)
      .digest("hex")
  };
}

export function changedPaths(cwd: string): string[] {
  const raw = git(cwd, ["status","--porcelain=v1"]);
  return raw
    ? raw.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim().replace(/\\/g,"/"))
    : [];
}
