import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { engineeringTempRoot } from "./managed-paths.mjs";
import { assertPrepushReady, intakeCurrentRemoteFailure } from "./readiness.mjs";
import { invalidatePrepushCertificate, recordFailure, recordMetricEvent } from "./experience.mjs";
import { findActiveTask, taskDirectory } from "./task-state.mjs";

export const releaseEnvironment = (source = process.env) => {
  const temporary = engineeringTempRoot("release");
  mkdirSync(temporary, { recursive: true });
  return { ...source, TEMP: temporary, TMP: temporary, TMPDIR: temporary };
};

export const runRelease = (args = process.argv.slice(2)) => {
  const publish = args[args.indexOf("--mode") + 1] === "publish";
  if (publish) assertPrepushReady();
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "release-controller.mjs"), ...args], { cwd: resolve(import.meta.dirname, "../.."), env: releaseEnvironment(), encoding: "utf8", shell: false });
  process.stdout.write(result.stdout ?? ""); process.stderr.write(result.stderr ?? "");
  const status = result.status ?? 2;
  if (publish && status !== 0) {
    const task = findActiveTask();
    if (task) { invalidatePrepushCertificate(task.taskId, "PUBLISH_FAILED"); recordFailure({ taskId: task.taskId, signature: result.stderr || result.stdout || `PUBLISH_FAILED:${status}`, evidenceRefs: ["release:publish"], environment: { platform: process.platform } }); }
    try { intakeCurrentRemoteFailure(); } catch { /* the release failure remains primary */ }
  }
  if (publish && status === 0) {
    const task = findActiveTask();
    if (task) {
      try {
        const delivery = JSON.parse(readFileSync(resolve(taskDirectory(task.taskId), "delivery.json"), "utf8")), runIds = [...new Set((delivery.checks ?? []).flatMap((check) => /\/actions\/runs\/(\d+)/.exec(check.link ?? "")?.[1] ?? []))];
        if (delivery.head) recordMetricEvent(task.taskId, { type: "push", key: delivery.head });
        for (const runId of runIds) recordMetricEvent(task.taskId, { type: "ci", key: `${runId}:${delivery.head}`, concluded: true, success: true });
      } catch { /* release success remains authoritative; missing metrics are never fabricated */ }
    }
  }
  return status;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = runRelease();
