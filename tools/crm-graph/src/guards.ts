import path from "node:path";
import fs from "node:fs";
import { minimatch } from "minimatch";
import type { EngineeringStateType } from "./state.js";
import type { TaskFile } from "./types.js";

const LEGAL_PERSISTENT_BLOCKERS = new Set([
  "EXTERNAL_DEPENDENCY",
  "HUMAN_APPROVAL_REQUIRED",
  "SAFETY_VIOLATION",
  "UNEXPECTED_SYSTEM_ERROR"
]);

export function requiredIncomplete(state: EngineeringStateType) {
  return state.acceptance.some(a => a.required && a.status !== "PASS");
}

export function implementationIncomplete(state: EngineeringStateType) {
  return state.acceptance.some(
    a => a.required && a.stage === "IMPLEMENTATION" && a.status !== "PASS"
  );
}

export function legalPersistentBlocker(state: EngineeringStateType) {
  const b = state.blocker;
  if (!b) return false;
  if (!LEGAL_PERSISTENT_BLOCKERS.has(b.type)) return false;
  if (b.type === "EXTERNAL_DEPENDENCY") return b.external;
  return true;
}

export function completionFlags(state: EngineeringStateType) {
  const implDone = !implementationIncomplete(state);
  return {
    implementationComplete: implDone,
    broadVerificationAllowed: implDone,
    canEnd: !requiredIncomplete(state) || legalPersistentBlocker(state)
  };
}

export function validateWorktree(canonicalRoot: string, worktreePath: string) {
  const root = path.resolve(canonicalRoot);
  const wt = path.resolve(worktreePath);
  if (wt === root) return [];
  const prefix = path.join(root, ".worktrees") + path.sep;
  return wt.startsWith(prefix)
    ? []
    : [`WORKTREE_LOCATION: ${wt} is outside ${prefix}`];
}

export function pathAllowed(task: TaskFile, candidate: string) {
  const c = candidate.replace(/\\/g, "/");
  return task.allowedPaths.some(p => {
    const pattern = p.replace(/\\/g, "/");
    return minimatch(c, pattern, { dot: true }) ||
      c === pattern.replace(/\/\*\*$/, "");
  });
}

export function outOfScopePaths(task: TaskFile, paths: string[]) {
  const controllerPaths = [
    ".crm-engineering/**",
    "docs/engineering-graph/**",
    "CRM_CONTEXT.md"
  ];
  return paths.filter(p => {
    const c = p.replace(/\\/g,"/");
    if (controllerPaths.some(q => minimatch(c,q,{dot:true}))) return false;
    return !pathAllowed(task, c);
  });
}

export function appliedMigrationDiffs(root: string, paths: string[]) {
  const policyPath = path.join(root, ".crm-engineering", "policy", "applied-migrations.json");
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8")) as { immutableThrough: number };
  return paths.filter(candidate => {
    const match = candidate.replace(/\\/g, "/").match(/^supabase\/migrations\/(\d+)_/);
    return match !== null && Number(match[1]) <= policy.immutableThrough;
  });
}

export function newlyChangedPaths(before: string[], after: string[]) {
  const known = new Set(before.map(p => p.replace(/\\/g, "/")));
  return after.map(p => p.replace(/\\/g, "/")).filter(p => !known.has(p));
}

export function nextFromProgress(state: EngineeringStateType) {
  if (!implementationIncomplete(state)) return "staticVerify";
  if (state.stallCount >= 3) return "humanEscalation";
  if (state.stallCount == 2) return "strategyChange";
  if (state.stallCount == 1) return "focusedRetry";
  return "implement";
}

export function requiresOwnerProductionGate(state: EngineeringStateType) {
  return state.acceptance.some(a => a.required && a.stage === "RELEASE" && a.status !== "PASS");
}
