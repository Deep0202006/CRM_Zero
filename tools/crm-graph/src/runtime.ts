export const DEFAULT_GRAPH_RECURSION_LIMIT = 128;
export const DEFAULT_GRAPH_RUNTIME_TIMEOUT_MS = 4 * 60 * 60_000;

export interface GraphExecutionPolicy {
  recursionLimit:number;
  runtimeTimeoutMs:number;
}

function boundedInteger(name:string, raw:string|undefined, fallback:number, minimum:number, maximum:number) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function graphExecutionPolicy(env:Record<string,string|undefined> = process.env):GraphExecutionPolicy {
  return {
    recursionLimit:boundedInteger("CRM_GRAPH_RECURSION_LIMIT",env.CRM_GRAPH_RECURSION_LIMIT,DEFAULT_GRAPH_RECURSION_LIMIT,32,512),
    runtimeTimeoutMs:boundedInteger("CRM_GRAPH_RUNTIME_TIMEOUT_MS",env.CRM_GRAPH_RUNTIME_TIMEOUT_MS,DEFAULT_GRAPH_RUNTIME_TIMEOUT_MS,60_000,24 * 60 * 60_000)
  };
}

export function graphRunConfig(taskId:string, policy:GraphExecutionPolicy) {
  return { configurable:{thread_id:taskId}, recursionLimit:policy.recursionLimit, timeout:policy.runtimeTimeoutMs };
}

export function checkpointDiagnostics(tuple:any) {
  if (!tuple) return {hasCheckpoint:false};
  const state = tuple.checkpoint?.channel_values ?? {};
  const pendingWrites = tuple.pendingWrites ?? [];
  return {
    hasCheckpoint:true,
    checkpointId:tuple.config?.configurable?.checkpoint_id ?? null,
    checkpointCreatedAt:tuple.checkpoint?.ts ?? null,
    graphStep:tuple.metadata?.step ?? null,
    graphSource:tuple.metadata?.source ?? null,
    currentNode:state.currentNode ?? null,
    phase:state.phase ?? null,
    nextLegalAction:state.nextLegalAction ?? null,
    focusedAcceptanceId:state.focusedAcceptanceId ?? null,
    workerIntent:state.workerIntent ?? null,
    workerRetryMode:state.workerRetryMode ?? null,
    workerFailureCount:state.workerFailureCount ?? 0,
    lastWorkerError:state.lastWorkerError ?? null,
    pendingWrites:pendingWrites.length,
    pendingInterrupts:pendingWrites.filter((write:any[]) => write[1] === "__interrupt__").length
  };
}

export function executionLimitKind(error:any):"RECURSION_LIMIT"|"RUNTIME_TIMEOUT"|null {
  if (error?.name === "GraphRecursionError") return "RECURSION_LIMIT";
  if (error?.name === "TimeoutError" || /(?:timed?\s*out|timeout)/i.test(String(error?.message ?? ""))) return "RUNTIME_TIMEOUT";
  return null;
}

export function executionLimitDiagnostic(taskId:string, policy:GraphExecutionPolicy, error:any, tuple:any) {
  const kind = executionLimitKind(error);
  if (!kind) return null;
  return {
    status:"EXECUTION_LIMIT",
    kind,
    taskId,
    thread_id:taskId,
    message:error instanceof Error ? error.message : String(error),
    limits:policy,
    checkpoint:checkpointDiagnostics(tuple),
    nextRequiredAction:kind === "RECURSION_LIMIT"
      ? "Inspect checkpoint progress before increasing CRM_GRAPH_RECURSION_LIMIT within the allowed range."
      : "Inspect the latest checkpoint and use --continue after addressing the slow or stalled operation."
  };
}
