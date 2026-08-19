import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function gitBuffer(cwd:string, args:string[]) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding:null, stdio:["ignore","pipe","pipe"] });
}

interface FingerprintOptions {
  beforeHashUntracked?:(relative:string)=>void;
}

function fingerprintAttempt(cwd:string, options:FingerprintOptions) {
  // Controller task/checkpoint projections mutate as part of legal execution;
  // they are persisted state, not owner working-tree baseline. Product and
  // proof content remain fingerprinted.
  const ignored = (candidate:string) => candidate === "CRM_CONTEXT.md" || candidate.startsWith(".crm-engineering/tasks/") || candidate.startsWith(".crm-engineering/runtime/");
  const rawStatus = gitBuffer(cwd, ["status","--porcelain=v1","-z"]);
  const statusRecords = rawStatus.toString("utf8").split("\0").filter(Boolean).filter(record => !ignored(record.slice(3).replace(/\\/g,"/")));
  const status = Buffer.from(statusRecords.length ? statusRecords.join("\0")+"\0" : "");
  const pathspec = ["--",".",":(exclude).crm-engineering/tasks/*.json",":(exclude)CRM_CONTEXT.md",":(exclude).crm-engineering/runtime/**"];
  const stagedDiff = gitBuffer(cwd, ["diff","--cached","HEAD","--binary","--no-ext-diff","--no-color",...pathspec]);
  const unstagedDiff = gitBuffer(cwd, ["diff","--binary","--no-ext-diff","--no-color",...pathspec]);
  const untrackedRaw = gitBuffer(cwd, ["ls-files","--others","--exclude-standard","-z"]);
  const untracked = untrackedRaw.toString("utf8").split("\0").filter(Boolean).filter(candidate => !ignored(candidate.replace(/\\/g,"/"))).sort();
  const hash = createHash("sha256");
  hash.update("CRM_WORKTREE_FINGERPRINT_V2\0");
  hash.update(status);
  hash.update("\0STAGED_DIFF\0");
  hash.update(stagedDiff);
  hash.update("\0UNSTAGED_DIFF\0");
  hash.update(unstagedDiff);
  hash.update("\0UNTRACKED\0");
  for (const relative of untracked) {
    options.beforeHashUntracked?.(relative);
    const contentId = git(cwd, ["hash-object","--no-filters","--",relative]);
    hash.update(relative, "utf8");
    hash.update("\0");
    hash.update(contentId, "ascii");
    hash.update("\0");
  }
  const trackedDiff = Buffer.concat([
    Buffer.from("STAGED\n"),stagedDiff,
    Buffer.from("\nUNSTAGED\n"),unstagedDiff
  ]).toString("utf8");
  return { hash:hash.digest("hex"), status:status.toString("utf8"), trackedDiff, untracked };
}

export function worktreeFingerprint(cwd:string, options:FingerprintOptions = {}) {
  let lastError:unknown;
  for (let attempt=1; attempt<=3; attempt++) {
    try {
      return fingerprintAttempt(cwd,options);
    } catch (error) {
      lastError=error;
    }
  }
  const message=lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`WORKTREE_FINGERPRINT_UNSTABLE: unable to capture a stable repository snapshot after 3 attempts: ${message}`);
}

export function inspectRepo(cwd: string) {
  const top = path.resolve(git(cwd, ["rev-parse","--show-toplevel"]));
  const branch = git(cwd, ["branch","--show-current"]) || null;
  const head = git(cwd, ["rev-parse","HEAD"]);
  const fingerprint = worktreeFingerprint(cwd);
  const status = fingerprint.status;
  const worktrees = git(cwd, ["worktree","list","--porcelain"]);
  return {
    top, branch, head, status, worktrees,
    dirtyHash: fingerprint.hash
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
  const fingerprint = worktreeFingerprint(cwd);
  return {
    diff:fingerprint.trackedDiff,
    untracked:fingerprint.untracked,
    hash:fingerprint.hash
  };
}

export function changedPaths(cwd: string): string[] {
  const records = gitBuffer(cwd,["status","--porcelain=v1","-z"]).toString("utf8").split("\0").filter(Boolean);
  const paths:string[] = [];
  for (let index=0; index<records.length; index++) {
    const record = records[index];
    const status = record.slice(0,2);
    paths.push(record.slice(3).replace(/\\/g,"/"));
    if (/[RC]/.test(status)) index++;
  }
  return paths;
}
