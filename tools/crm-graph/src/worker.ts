import type { TaskFile } from "./types.js";
import { CodexAppServer } from "./codex-app-server.js";

export interface WorkerResult {
  taskId: string;
  acceptanceUpdates: { id:string; status:"PASS"|"FAIL"|"PENDING"; evidenceIds:string[] }[];
  changedPaths: string[];
  externalBlocker: null | { reason:string };
  summary: string;
}

function extractJson(text:string): WorkerResult {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Codex worker did not return JSON.");
  return JSON.parse(m[0]);
}

export async function runCodexWorker(task:TaskFile, contextPacket:string, threadId?:string|null) {
  if (!task.repository.worktreePath) throw new Error("Task worktree is not set.");

  const server = new CodexAppServer();
  await server.initialize();
  const tid = threadId ?? await server.startThread(task.repository.worktreePath);

  const prompt = [
    "You are an implementation worker inside CRM Engineering Graph.",
    "You do NOT own task completion, BLOCKED state, phase transitions, release, or production authorization.",
    "Work only on the current acceptance slice using the supplied context.",
    "Do not read legacy docs/os or .harness for workflow.",
    "Do not run broad verification unless the context explicitly says implementation is complete.",
    "",
    contextPacket,
    "",
    "At the end return JSON only:",
    '{"taskId":"...","acceptanceUpdates":[{"id":"...","status":"PASS|FAIL|PENDING","evidenceIds":["..."]}],"changedPaths":["..."],"externalBlocker":null,"summary":"..."}',
    "If work remains and there is no external dependency, keep implementing rather than returning a status report."
  ].join("\n");

  try {
    const result = await server.runTurn(tid, task.repository.worktreePath, prompt);
    return { threadId:tid, result:extractJson(result.text), raw:result.text };
  } finally {
    server.close();
  }
}
