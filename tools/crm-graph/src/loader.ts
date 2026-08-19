import fs from "node:fs";
import path from "node:path";
import type { TaskFile } from "./types.js";

export function taskPath(root: string, id: string) {
  return path.join(root, ".crm-engineering", "tasks", `${id}.json`);
}

export function loadTask(root: string, id: string): TaskFile {
  const p = taskPath(root, id);
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  if (raw.schemaVersion !== 2) throw new Error(`Unsupported task schema: ${raw.schemaVersion}`);
  return raw as TaskFile;
}

export function saveTask(root: string, task: TaskFile) {
  const p = taskPath(root, task.taskId);
  fs.writeFileSync(p, JSON.stringify(task, null, 2) + "\n", "utf8");
}
