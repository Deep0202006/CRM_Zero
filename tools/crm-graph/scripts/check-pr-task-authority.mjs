import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { minimatch } from "minimatch";

const graphOnlyPatterns = [
  /^\.crm-engineering\//,
  /^tools\/crm-graph\//,
  /^docs\/engineering-graph\//,
  /^AGENTS\.md$/,
  /^CRM_CONTEXT\.md$/
];

function normalize(value) {
  return value.trim().replace(/\\/g, "/");
}

function isGraphOnly(paths) {
  return paths.length > 0 && paths.every(candidate =>
    graphOnlyPatterns.some(pattern => pattern.test(candidate))
  );
}

function pathAllowed(task, candidate) {
  return task.allowedPaths.some(value => {
    const pattern = normalize(value);
    return minimatch(candidate, pattern, { dot: true }) ||
      candidate === pattern.replace(/\/\*\*$/, "");
  });
}

export function checkPrTaskAuthority({ baseSha, changedPaths, changedTasks }) {
  const paths = changedPaths.map(normalize).filter(Boolean);
  if (isGraphOnly(paths)) return { required: false, taskId: null };

  if (changedTasks.length === 0) {
    throw new Error("GRAPH_TASK_REQUIRED: product/schema/full-scope pull requests must change an authoritative Graph task");
  }

  const failures = [];
  for (const entry of changedTasks) {
    const task = entry.task;
    const taskId = typeof task.taskId === "string" ? task.taskId : "<missing>";
    const expectedFile = `.crm-engineering/tasks/${taskId}.json`;
    if (entry.path !== expectedFile) {
      failures.push(`${entry.path}: TASK_ID_FILE_MISMATCH (${taskId})`);
      continue;
    }
    if (!task.repository || task.repository.expectedBaseSha !== baseSha) {
      failures.push(`${entry.path}: BASE_MISMATCH (expected ${baseSha})`);
      continue;
    }
    if (!Array.isArray(task.allowedPaths) || task.allowedPaths.length === 0) {
      failures.push(`${entry.path}: ALLOWED_PATHS_MISSING`);
      continue;
    }
    const uncovered = paths.filter(candidate => !pathAllowed(task, candidate));
    if (uncovered.length > 0) {
      failures.push(`${entry.path}: DIFF_NOT_COVERED (${uncovered.join(", ")})`);
      continue;
    }
    return { required: true, taskId };
  }

  throw new Error(`GRAPH_TASK_INCOHERENT: no changed task authorizes the complete PR diff\n${failures.join("\n")}`);
}

function gitDiff(base, head) {
  const result = spawnSync("git", ["diff", "--name-only", "-z", base, head], {
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) throw new Error(result.stderr || "Unable to read pull-request diff");
  return result.stdout.split("\0").map(normalize).filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const baseSha = process.argv[process.argv.indexOf("--base") + 1];
    const headSha = process.argv[process.argv.indexOf("--head") + 1];
    if (!baseSha || !headSha) throw new Error("Usage: check-pr-task-authority.mjs --base <sha> --head <sha>");
    const changedPaths = gitDiff(baseSha, headSha);
    const changedTasks = changedPaths
      .filter(candidate => /^\.crm-engineering\/tasks\/[^/]+\.json$/.test(candidate))
      .map(candidate => ({ path: candidate, task: JSON.parse(fs.readFileSync(candidate, "utf8")) }));
    const result = checkPrTaskAuthority({ baseSha, changedPaths, changedTasks });
    process.stdout.write(result.required
      ? `Graph task authority verified: ${result.taskId}\n`
      : "Graph-only diff: product/schema task authority check not required\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
