import { inspectRepo } from "./git.js";

export interface RepositoryInspectionDiagnostic {
  code: "BOUND_WORKTREE_UNAVAILABLE";
  boundWorktreePath: string;
  message: string;
}

export type BoundRepositoryInspection =
  | { repo:ReturnType<typeof inspectRepo>; repositoryDiagnostic:null }
  | { repo:null; repositoryDiagnostic:RepositoryInspectionDiagnostic|null };

export function inspectBoundRepository(worktreePath:string|null):BoundRepositoryInspection {
  if (!worktreePath) return { repo:null, repositoryDiagnostic:null };
  try {
    return { repo:inspectRepo(worktreePath), repositoryDiagnostic:null };
  } catch (error) {
    const message=error instanceof Error ? error.message : String(error);
    return {
      repo:null,
      repositoryDiagnostic:{
        code:"BOUND_WORKTREE_UNAVAILABLE" as const,
        boundWorktreePath:worktreePath,
        message
      }
    };
  }
}
