import fs from "node:fs";
import path from "node:path";
import { git, inspectRepo, isAncestor } from "./git.js";
import { validateWorktree } from "./guards.js";
import type { TaskFile } from "./types.js";

export function bindTaskRepository(task:TaskFile, worktreePath:string) {
  const canonicalRoot = fs.realpathSync.native(path.resolve(task.repository.canonicalRoot));
  const requested = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(canonicalRoot,worktreePath);
  const resolved = fs.realpathSync.native(path.resolve(requested));
  const old = structuredClone(task.repository);
  if (task.phase !== "REPOSITORY_RECOVERY") {
    if (!task.repository.worktreePath) throw new Error(`BIND_PHASE_INVALID: ${task.phase} task has no recoverable repository binding`);
    const existing = fs.realpathSync.native(path.resolve(task.repository.worktreePath));
    if (existing !== resolved) throw new Error(`REPOSITORY_ALREADY_BOUND: ${task.taskId} is bound to ${existing}`);
    return { old, next:structuredClone(task.repository), unchanged:true };
  }
  const locationErrors = validateWorktree(canonicalRoot, resolved);
  if (locationErrors.length) throw new Error(locationErrors.join("; "));
  const repo = inspectRepo(resolved);
  if (fs.realpathSync.native(repo.top) !== resolved) throw new Error(`WORKTREE_ROOT_REQUIRED: ${resolved} resolves to ${repo.top}`);
  const canonicalCommonDir = fs.realpathSync.native(git(canonicalRoot,["rev-parse","--path-format=absolute","--git-common-dir"]));
  const worktreeCommonDir = fs.realpathSync.native(git(resolved,["rev-parse","--path-format=absolute","--git-common-dir"]));
  if (canonicalCommonDir !== worktreeCommonDir) throw new Error(`REPOSITORY_IDENTITY_MISMATCH: ${resolved} is not a worktree of ${canonicalRoot}`);
  if (!repo.branch) throw new Error("DETACHED_WORKTREE_REJECTED: bind requires a branch");
  if (task.repository.branch && task.repository.branch !== repo.branch) {
    throw new Error(`BRANCH_MISMATCH: task expects ${task.repository.branch}, observed ${repo.branch}`);
  }
  const expectedBaseRef = task.repository.expectedBaseRef || "origin/main";
  const expectedBaseSha = git(resolved, ["rev-parse","--verify",`${expectedBaseRef}^{commit}`]);
  if (!isAncestor(resolved, expectedBaseSha, repo.head)) {
    throw new Error(`BASE_NOT_ANCESTOR: ${expectedBaseSha} is not an ancestor of ${repo.head}`);
  }
  task.repository = {
    canonicalRoot,
    worktreePath:resolved,
    branch:repo.branch,
    expectedBaseRef,
    expectedBaseSha,
    observedHeadSha:repo.head,
    dirtyBaselineHash:repo.dirtyHash
  };
  if (task.phase === "REPOSITORY_RECOVERY") task.phase = "DISCOVERY";
  return { old, next:task.repository, unchanged:false };
}
