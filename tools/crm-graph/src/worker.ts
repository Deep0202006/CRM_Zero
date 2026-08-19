import fs from "node:fs";
import path from "node:path";
import type { AcceptanceItem, TaskFile } from "./types.js";
import { CodexAppServer } from "./codex-app-server.js";

export type WorkerIntent = "IMPLEMENT" | "VERIFY";
export type WorkerRetryMode = "INITIAL"|"FOCUSED_RETRY"|"STRATEGY_CHANGE"|"ESCALATE";
export interface WorkerRuntimeContext {
  retryMode:WorkerRetryMode;
  failureCount:number;
  previousError?:{code:string;message:string;attempt:number}|null;
  strategyGuidance?:string|null;
}
export interface WorkerResult {
  taskId: string;
  acceptanceUpdates: { id:string; status:"PASS"|"FAIL"|"PENDING"; evidenceIds:string[] }[];
  changedPaths: string[];
  externalBlocker: null | { reason:string };
  summary: string;
}

export class WorkerResultError extends Error {
  constructor(public readonly code:string, message:string) {
    super(`${code}: ${message}`);
    this.name = "WorkerResultError";
  }
}

export interface WorkerSessionLike {
  run(task:TaskFile, contextPacket:string, intent:WorkerIntent, acceptance:AcceptanceItem, savedThreadId?:string|null, runtime?:WorkerRuntimeContext):Promise<{threadId:string;result:WorkerResult;raw:string}>;
  close():void;
}

export async function loadSavedCodexThreadId(checkpointer:any, graphThreadId:string):Promise<string|null> {
  const tuple = await checkpointer.getTuple({ configurable:{ thread_id:graphThreadId } });
  const saved = tuple?.checkpoint?.channel_values?.codexThreadId;
  if (saved === undefined || saved === null) return null;
  if (typeof saved !== "string" || !saved.trim()) {
    throw new Error(`CODEX_WORKER_INVALID_SAVED_THREAD: checkpoint ${graphThreadId} contains an invalid Codex thread id`);
  }
  return saved;
}

export function extractWorkerJson(text:string):WorkerResult {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("CODEX_WORKER_MALFORMED_RESULT: no JSON object returned");
  return JSON.parse(match[0]);
}

export function validateWorkerResult(task:TaskFile, result:WorkerResult, focusedAcceptance?:AcceptanceItem, intent?:WorkerIntent) {
  if (!result || typeof result !== "object") throw new Error("CODEX_WORKER_MALFORMED_RESULT: expected an object");
  if (result.taskId !== task.taskId) throw new Error(`CODEX_WORKER_TASK_MISMATCH: expected ${task.taskId}, received ${result.taskId}`);
  if (!Array.isArray(result.acceptanceUpdates)) throw new Error("CODEX_WORKER_MALFORMED_RESULT: acceptanceUpdates must be an array");
  if (!Array.isArray(result.changedPaths) || result.changedPaths.some(candidate => typeof candidate !== "string")) {
    throw new Error("CODEX_WORKER_MALFORMED_RESULT: changedPaths must be a string array");
  }
  if (result.externalBlocker !== null) {
    if (!result.externalBlocker || typeof result.externalBlocker !== "object" || typeof result.externalBlocker.reason !== "string" || !result.externalBlocker.reason.trim()) {
      throw new WorkerResultError("CODEX_WORKER_MALFORMED_EXTERNAL_BLOCKER","externalBlocker requires a non-empty reason");
    }
  }
  if (typeof result.summary !== "string") throw new Error("CODEX_WORKER_MALFORMED_RESULT: summary must be a string");
  const known = new Set(task.acceptance.map(item => item.id));
  if (focusedAcceptance && intent) {
    const expectedStage = intent === "IMPLEMENT" ? "IMPLEMENTATION" : "VERIFICATION";
    if (focusedAcceptance.stage !== expectedStage) {
      throw new Error(`CODEX_WORKER_STAGE_MISMATCH: ${intent} cannot execute ${focusedAcceptance.stage} acceptance ${focusedAcceptance.id}`);
    }
    if (intent === "VERIFY" && task.acceptance.some(item => item.required && item.stage === "IMPLEMENTATION" && item.status !== "PASS")) {
      throw new Error("CODEX_WORKER_VERIFICATION_BEFORE_IMPLEMENTATION: required implementation acceptance remains incomplete");
    }
    if (result.acceptanceUpdates.length !== 1 || result.acceptanceUpdates[0]?.id !== focusedAcceptance.id) {
      throw new Error(`CODEX_WORKER_FOCUSED_ACCEPTANCE_MISMATCH: expected exactly one update for ${focusedAcceptance.id}`);
    }
  }
  for (const update of result.acceptanceUpdates) {
    if (!known.has(update.id)) throw new Error(`CODEX_WORKER_UNKNOWN_ACCEPTANCE: ${update.id}`);
    if (update.status === "PASS" && (!Array.isArray(update.evidenceIds) || update.evidenceIds.length === 0)) {
      throw new Error(`CODEX_WORKER_EVIDENCE_REQUIRED: ${update.id}`);
    }
    for (const evidenceId of update.evidenceIds) {
      if (!evidenceId.trim()) throw new Error(`CODEX_WORKER_EMPTY_EVIDENCE: ${update.id}`);
      if (evidenceId.startsWith(".crm-engineering/")) {
        const evidencePath = path.join(task.repository.worktreePath!, evidenceId);
        if (!fs.existsSync(evidencePath)) throw new Error(`CODEX_WORKER_EVIDENCE_MISSING: ${evidenceId}`);
      }
    }
  }
}

export class CodexWorkerSession implements WorkerSessionLike {
  private server:CodexAppServer|null = null;
  private initialized = false;
  private liveThreadId:string|null = null;
  constructor(private readonly serverFactory:()=>CodexAppServer = () => new CodexAppServer()) {}

  async run(task:TaskFile, contextPacket:string, intent:WorkerIntent, acceptance:AcceptanceItem, savedThreadId?:string|null, runtime?:WorkerRuntimeContext) {
    if (!task.repository.worktreePath) throw new Error("Task worktree is not set.");
    this.server ??= this.serverFactory();
    if (!this.initialized) {
      await this.server.initialize();
      this.initialized = true;
    }
    if (!this.liveThreadId) {
      this.liveThreadId = savedThreadId
        ? await this.server.resumeThread(savedThreadId, task.repository.worktreePath)
        : await this.server.startThread(task.repository.worktreePath);
    }
    const retryInstruction = runtime?.retryMode === "FOCUSED_RETRY"
      ? `Focused retry ${runtime.failureCount + 1}: address the prior ${runtime.previousError?.code ?? "worker failure"} without broadening the acceptance slice.`
      : runtime?.retryMode === "STRATEGY_CHANGE"
        ? `Strategy-change retry ${runtime.failureCount + 1}: the prior approach failed repeatedly. Use a materially different in-scope implementation strategy. Guidance: ${runtime.strategyGuidance ?? "none supplied"}. Prior error: ${runtime.previousError?.code ?? "unknown"}.`
        : null;
    const prompt = [
      `You are the bounded ${intent} worker inside CRM Engineering Graph.`,
      "You do NOT own task completion, BLOCKED state, phase transitions, release, or production authorization.",
      `Work only on acceptance ${acceptance.id}: ${acceptance.description}`,
      "Work only inside allowed paths. Never use legacy docs/os or .harness as workflow authority.",
      intent === "VERIFY"
        ? "Run real task-specific verification. PASS requires commands/artifacts that actually exist; prose is not evidence. If a defect is found, repair only in scope and keep verification PENDING until rerun."
        : "Implement this slice. Do not run broad verification; focused proof for this slice is allowed.",
      "Never contact production systems.",
      ...(retryInstruction ? [retryInstruction] : []),
      "",
      contextPacket,
      "",
      "Return JSON only:",
      '{"taskId":"...","acceptanceUpdates":[{"id":"...","status":"PASS|FAIL|PENDING","evidenceIds":["..."]}],"changedPaths":["..."],"externalBlocker":null,"summary":"..."}'
    ].join("\n");
    const turn = await this.server.runTurn(this.liveThreadId, task.repository.worktreePath, prompt);
    const result = extractWorkerJson(turn.text);
    validateWorkerResult(task, result, acceptance, intent);
    return { threadId:this.liveThreadId, result, raw:turn.text };
  }

  close() {
    this.server?.close();
    this.server = null;
    this.initialized = false;
    this.liveThreadId = null;
  }
}
