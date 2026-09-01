import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { engineeringTempRoot } from "./managed-paths.mjs";
import { assertPrepushReady, intakeCurrentRemoteFailure } from "./readiness.mjs";
import { updateTaskMetrics } from "./experience.mjs";
import { findActiveTask } from "./task-state.mjs";

export const releaseEnvironment = (source = process.env) => {
  const temporary = engineeringTempRoot("release");
  mkdirSync(temporary, { recursive: true });
  return { ...source, TEMP: temporary, TMP: temporary, TMPDIR: temporary };
};

export const runRelease = (args = process.argv.slice(2)) => {
  const publish = args[args.indexOf("--mode") + 1] === "publish";
  if (publish) assertPrepushReady();
  const status = spawnSync(process.execPath, [resolve(import.meta.dirname, "release-controller.mjs"), ...args], { cwd: resolve(import.meta.dirname, "../.."), env: releaseEnvironment(), stdio: "inherit", shell: false }).status ?? 2;
  if (publish && status !== 0) try { intakeCurrentRemoteFailure(); } catch { /* the release failure remains primary */ }
  if (publish && status === 0) { const task = findActiveTask(); if (task) updateTaskMetrics(task.taskId, (metrics) => ({ ...metrics, pushCount: (metrics.pushCount ?? 0) + 1, ciAttemptCount: (metrics.ciAttemptCount ?? 0) + 1, firstPassCiSuccess: (metrics.ciAttemptCount ?? 0) === 0 })); }
  return status;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = runRelease();
