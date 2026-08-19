import fs from "node:fs";
import path from "node:path";
import { END, START, StateGraph, interrupt, type GraphNode } from "@langchain/langgraph";
import { EngineeringState, type EngineeringStateType } from "./state.js";
import { inspectRepo, diffSnapshot, changedPaths, isAncestor } from "./git.js";
import { compileContext } from "./context.js";
import { loadTask, saveTask } from "./loader.js";
import { appliedMigrationDiffs, completionFlags, newlyChangedPaths, outOfScopePaths, requiresOwnerProductionGate, validateWorktree } from "./guards.js";
import { validateWorkerResult, type WorkerSessionLike } from "./worker.js";

function taskFromState(state:EngineeringStateType) { return loadTask(state.graphRoot, state.taskId); }
function incomplete(state:EngineeringStateType, stage:"IMPLEMENTATION"|"VERIFICATION") {
  return state.acceptance.find(item => item.required && item.stage === stage && item.status !== "PASS");
}

const repoPreflight:GraphNode<typeof EngineeringState> = state => {
  const findings:string[] = [];
  try {
    const repo = inspectRepo(state.worktreePath);
    findings.push(...validateWorktree(state.canonicalRoot, state.worktreePath));
    if (!state.expectedBaseSha || !state.dirtyBaselineHash) findings.push("REPOSITORY_BASELINE_UNKNOWN: expected base SHA and dirty fingerprint are required.");
    else if (repo.dirtyHash !== state.dirtyBaselineHash) findings.push("DIRTY_BASELINE_MISMATCH: worktree content changed since task binding.");
    if (state.expectedBaseSha && state.phase !== "REPOSITORY_RECOVERY" && !isAncestor(state.worktreePath, state.expectedBaseSha, repo.head)) {
      findings.push(`BASE_SHA_NOT_ANCESTOR: expected ${state.expectedBaseSha}, observed ${repo.head}`);
    }
    return { currentNode:"repoPreflight", branch:repo.branch, observedHeadSha:repo.head, repoHealthy:findings.length === 0, findings:[...state.findings,...findings] };
  } catch (error:any) {
    return { currentNode:"repoPreflight", repoHealthy:false, blocker:{type:"ENVIRONMENT_DRIFT",external:false,reason:error.message,evidenceIds:[]}, findings:[...state.findings,"Repository preflight failed."] };
  }
};

const contextNode:GraphNode<typeof EngineeringState> = state => ({ currentNode:"context", contextPacket:compileContext(state.graphRoot, taskFromState(state)) });
const barrierNode:GraphNode<typeof EngineeringState> = state => ({ currentNode:"barrier", ...completionFlags(state) });

const beforeWorker:GraphNode<typeof EngineeringState> = state => {
  const intent = incomplete(state,"IMPLEMENTATION") ? "IMPLEMENT" : "VERIFY";
  const acceptance = incomplete(state, intent === "IMPLEMENT" ? "IMPLEMENTATION" : "VERIFICATION");
  const snap = diffSnapshot(state.worktreePath);
  return {
    currentNode:"beforeWorker", workerIntent:intent, focusedAcceptanceId:acceptance?.id ?? null,
    beforeDiffHash:snap.hash, beforeChangedPaths:changedPaths(state.worktreePath),
    beforePassCount:state.acceptance.filter(item => item.status === "PASS").length,
    codexResultValid:false,
    nextLegalAction:intent
  };
};

function workerError(error:any, attempt:number) {
  return {
    code:typeof error?.code === "string" ? error.code : "CODEX_WORKER_RUNTIME_ERROR",
    message:error instanceof Error ? error.message : String(error),
    stderrTail:typeof error?.stderrTail === "string" ? error.stderrTail : undefined,
    attempt,
    occurredAt:new Date().toISOString()
  };
}

export function buildGraph(checkpointer:any, workerSession:WorkerSessionLike) {
  const workerNode:GraphNode<typeof EngineeringState> = async state => {
    if (state.mode === "shadow") return { currentNode:"worker", findings:[...state.findings,`SHADOW: would invoke ${state.workerIntent} worker.`] };
    const task = taskFromState(state);
    const acceptance = task.acceptance.find(item => item.id === state.focusedAcceptanceId);
    if (!acceptance) return { currentNode:"worker", lastWorkerError:workerError(new Error("FOCUSED_ACCEPTANCE_MISSING"),state.stallCount+1) };
    if (state.workerIntent === "VERIFY" && task.acceptance.some(item => item.required && item.stage === "IMPLEMENTATION" && item.status !== "PASS")) {
      const error = new Error("CODEX_WORKER_VERIFICATION_BEFORE_IMPLEMENTATION: required implementation acceptance remains incomplete");
      const typedError = workerError(error,state.workerFailureCount+1);
      return {
        currentNode:"worker", codexResultValid:false, lastWorkerError:typedError,
        workerFailureCount:state.workerFailureCount+1, workerErrorHistory:[...state.workerErrorHistory,typedError],
        findings:[...state.findings,typedError.message]
      };
    }
    try {
      const worker = await workerSession.run(task, state.contextPacket, state.workerIntent, acceptance, state.codexThreadId, {
        retryMode:state.workerRetryMode,
        failureCount:state.workerFailureCount,
        previousError:state.lastWorkerError,
        strategyGuidance:state.workerStrategyGuidance
      });
      validateWorkerResult(task,worker.result,acceptance,state.workerIntent);
      for (const update of worker.result.acceptanceUpdates) {
        const target = task.acceptance.find(item => item.id === update.id);
        if (!target) continue;
        target.status = update.status;
        target.evidenceIds = [...new Set([...target.evidenceIds,...update.evidenceIds])];
      }
      if (worker.result.externalBlocker) task.blocker = { type:"EXTERNAL_DEPENDENCY", external:true, reason:worker.result.externalBlocker.reason };
      else if (task.blocker && !task.blocker.external) task.blocker = null;
      task.phase = state.workerIntent === "IMPLEMENT" ? "IMPLEMENTATION" : "TARGETED_VERIFICATION";
      saveTask(state.graphRoot, task);
      return {
        currentNode:"worker", acceptance:task.acceptance, blocker:task.blocker, phase:task.phase,
        codexThreadId:worker.threadId, codexLastMessage:worker.raw, codexResultValid:true,
        lastWorkerError:null, workerFailureCount:0, workerRetryMode:"INITIAL", workerStrategyGuidance:null
      };
    } catch (error:any) {
      const typedError = workerError(error,state.workerFailureCount+1);
      return {
        currentNode:"worker", codexResultValid:false, lastWorkerError:typedError,
        workerFailureCount:state.workerFailureCount+1,
        workerRetryMode:state.workerFailureCount+1 >= 3 ? "ESCALATE" : state.workerRetryMode,
        workerErrorHistory:[...state.workerErrorHistory,typedError],
        findings:[...state.findings,`WORKER_FAILURE_${typedError.attempt}: ${typedError.code}: ${typedError.message}`]
      };
    }
  };

  const progressNode:GraphNode<typeof EngineeringState> = state => {
    const after = diffSnapshot(state.worktreePath);
    const task = taskFromState(state);
    const paths = newlyChangedPaths(state.beforeChangedPaths, changedPaths(state.worktreePath));
    const out = outOfScopePaths(task, paths);
    const immutable = appliedMigrationDiffs(state.graphRoot, paths);
    if (out.length || immutable.length) {
      const violations = [...(out.length ? [`Out-of-scope paths: ${out.join(", ")}`] : []),...(immutable.length ? [`Applied migrations are immutable: ${immutable.join(", ")}`] : [])];
      return { currentNode:"progressGuard", blocker:{type:"SAFETY_VIOLATION",external:false,reason:violations.join("; "),evidenceIds:[]}, findings:[...state.findings,...violations] };
    }
    const passCount = state.acceptance.filter(item => item.status === "PASS").length;
    const noProgress = after.hash === state.beforeDiffHash && passCount === state.beforePassCount && !state.blocker?.external;
    return {
      currentNode:"progressGuard", afterDiffHash:after.hash, afterPassCount:passCount,
      stallCount:noProgress ? state.stallCount + 1 : 0,
      findings:noProgress ? [...state.findings,"STALL: no content fingerprint delta and no acceptance delta."] : state.findings
    };
  };

  const focusedRetry:GraphNode<typeof EngineeringState> = state => ({ currentNode:"focusedRetry", workerRetryMode:"FOCUSED_RETRY", findings:[...state.findings,"WORKER_RETRY_1: focused retry for current acceptance."] });
  const strategyChange:GraphNode<typeof EngineeringState> = state => ({ currentNode:"strategyChange", workerRetryMode:"STRATEGY_CHANGE", findings:[...state.findings,"WORKER_RETRY_2: alternate implementation strategy required."] });
  const humanEscalation:GraphNode<typeof EngineeringState> = state => {
    const answer = interrupt({
      type:"AGENT_STALL", taskId:state.taskId, stallCount:state.stallCount,
      workerFailureCount:state.workerFailureCount, retrySequence:["FOCUSED_RETRY","STRATEGY_CHANGE","ESCALATE"],
      lastWorkerError:state.lastWorkerError, workerErrorHistory:state.workerErrorHistory,
      instruction:"Provide structured strategy guidance to resume the same checkpoint."
    });
    return {
      currentNode:"humanEscalation", findings:[...state.findings,`Human strategy response: ${JSON.stringify(answer)}`],
      stallCount:0, workerFailureCount:0, workerRetryMode:"STRATEGY_CHANGE",
      workerStrategyGuidance:JSON.stringify(answer), lastWorkerError:null
    };
  };
  const reviewNode:GraphNode<typeof EngineeringState> = state => ({ currentNode:"review", phase:"REVIEW", nextLegalAction:"REVIEW" });
  const productionGate:GraphNode<typeof EngineeringState> = state => {
    const answer:any = interrupt({ type:"OWNER_PRODUCTION_GATE", taskId:state.taskId, instruction:"Owner must manually apply reviewed production SQL, then provide durable read-only postcheck evidence IDs." });
    const task = taskFromState(state);
    const release = task.acceptance.find(item => item.required && item.stage === "RELEASE" && item.status !== "PASS");
    const evidenceIds = Array.isArray(answer?.evidenceIds) ? answer.evidenceIds.filter((id:any) => typeof id === "string" && id.trim()) : [];
    const durable = evidenceIds.every((id:string) => !id.startsWith(".crm-engineering/") || fs.existsSync(path.join(state.worktreePath,id)));
    if (release && evidenceIds.length && durable && answer?.verified === true) {
      release.status = "PASS";
      release.evidenceIds = [...new Set([...release.evidenceIds,...evidenceIds])];
      task.humanGate = task.humanGate ? {...task.humanGate,status:"SATISFIED"} : null;
      saveTask(state.graphRoot,task);
      return { currentNode:"productionGate", acceptance:task.acceptance, findings:[...state.findings,"Owner gate resumed with durable evidence."] };
    }
    return { currentNode:"productionGate", findings:[...state.findings,"Owner response lacked verified durable evidence; release remains pending."] };
  };
  const completeNode:GraphNode<typeof EngineeringState> = state => {
    const task = taskFromState(state);
    task.phase = "COMPLETE";
    saveTask(state.graphRoot,task);
    return { currentNode:"complete", phase:"COMPLETE", canEnd:true, nextLegalAction:"END" };
  };

  return new StateGraph(EngineeringState)
    .addNode("repoPreflight",repoPreflight).addNode("context",contextNode).addNode("barrier",barrierNode)
    .addNode("beforeWorker",beforeWorker).addNode("worker",workerNode).addNode("progressGuard",progressNode)
    .addNode("focusedRetry",focusedRetry).addNode("strategyChange",strategyChange).addNode("humanEscalation",humanEscalation)
    .addNode("review",reviewNode).addNode("productionGate",productionGate).addNode("complete",completeNode)
    .addEdge(START,"repoPreflight")
    .addConditionalEdges("repoPreflight",(state:any)=>state.repoHealthy ? "context" : END)
    .addEdge("context","barrier")
    .addConditionalEdges("barrier",(state:any)=>{
      if (incomplete(state,"IMPLEMENTATION")) return "beforeWorker";
      if (incomplete(state,"VERIFICATION")) return "beforeWorker";
      if (requiresOwnerProductionGate(state)) return "productionGate";
      return completionFlags(state).canEnd ? "complete" : END;
    })
    .addEdge("beforeWorker","worker").addEdge("worker","progressGuard")
    .addConditionalEdges("progressGuard",(state:any)=>{
      if (state.blocker?.type === "SAFETY_VIOLATION" || state.mode === "shadow") return END;
      if (state.workerFailureCount >= 3 || state.stallCount >= 3) return "humanEscalation";
      if (state.workerFailureCount === 2 || state.stallCount === 2) return "strategyChange";
      if (state.workerFailureCount === 1 || state.stallCount === 1) return "focusedRetry";
      if (!incomplete(state,"IMPLEMENTATION") && !incomplete(state,"VERIFICATION")) return "review";
      return "barrier";
    })
    .addEdge("focusedRetry","beforeWorker").addEdge("strategyChange","beforeWorker").addEdge("humanEscalation","beforeWorker")
    .addEdge("review","barrier").addEdge("productionGate","barrier").addEdge("complete",END)
    .compile({checkpointer});
}
