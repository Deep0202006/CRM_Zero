import { END, START, StateGraph, interrupt, type GraphNode } from "@langchain/langgraph";
import { EngineeringState, type EngineeringStateType } from "./state.js";
import { inspectRepo, diffSnapshot, changedPaths, isAncestor } from "./git.js";
import { compileContext } from "./context.js";
import { loadTask, saveTask } from "./loader.js";
import { appliedMigrationDiffs, completionFlags, newlyChangedPaths, nextFromProgress, outOfScopePaths, requiresOwnerProductionGate, validateWorktree } from "./guards.js";
import { runCodexWorker } from "./worker.js";
import path from "node:path";

function taskFromState(state: EngineeringStateType) {
  return loadTask(state.graphRoot, state.taskId);
}

const repoPreflight: GraphNode<typeof EngineeringState> = (state) => {
  const findings:string[] = [];
  try {
    const repo = inspectRepo(state.worktreePath);
    findings.push(...validateWorktree(state.canonicalRoot, state.worktreePath));

    if (!state.expectedBaseSha || !state.dirtyBaselineHash) {
      findings.push("REPOSITORY_BASELINE_UNKNOWN: expected base SHA and dirty baseline hash are required.");
    } else if (repo.dirtyHash !== state.dirtyBaselineHash) {
      findings.push("DIRTY_BASELINE_MISMATCH: preserved worktree state changed since task baseline.");
    }

    const expected = state.expectedBaseSha;
    if (expected && state.phase !== "REPOSITORY_RECOVERY") {
      // A feature HEAD may advance beyond expected base; exact equality is required
      // only at initial implementation bootstrap when the task still has no accepted work.
      const anyPass = state.acceptance.some((a:any) => a.status === "PASS");
      if (!anyPass && !isAncestor(state.worktreePath, expected, repo.head)) {
        findings.push(`BASE_SHA_NOT_ANCESTOR: expected ${expected}, observed ${repo.head}`);
      }
    }

    return {
      currentNode:"repoPreflight",
      branch:repo.branch,
      observedHeadSha:repo.head,
      repoHealthy:findings.length === 0,
      findings:[...state.findings,...findings]
    };
  } catch (e:any) {
    return {
      currentNode:"repoPreflight",
      repoHealthy:false,
      blocker:{type:"ENVIRONMENT_DRIFT",external:false,reason:e.message,evidenceIds:[]},
      findings:[...state.findings,"Repository preflight failed."]
    };
  }
};

const contextNode: GraphNode<typeof EngineeringState> = (state) => {
  const task = taskFromState(state);
  const packet = compileContext(state.graphRoot, task);
  return { currentNode:"context", contextPacket:packet };
};

const barrierNode: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"barrier",
  ...completionFlags(state)
});

const beforeNode: GraphNode<typeof EngineeringState> = (state) => {
  const snap = diffSnapshot(state.worktreePath);
  return {
    currentNode:"beforeImplement",
    beforeDiffHash:snap.hash,
    beforeChangedPaths:changedPaths(state.worktreePath),
    beforePassCount:state.acceptance.filter((a:any)=>a.status==="PASS").length
  };
};

const implementNode: GraphNode<typeof EngineeringState> = async (state) => {
  if (state.mode === "shadow") {
    return {
      currentNode:"implement",
      nextLegalAction:"IMPLEMENT",
      findings:[...state.findings,"SHADOW: controller would invoke Codex implementer here."]
    };
  }

  const task = taskFromState(state);
  const worker = await runCodexWorker(task, state.contextPacket, state.codexThreadId);

  for (const upd of worker.result.acceptanceUpdates) {
    const target = task.acceptance.find(a => a.id === upd.id);
    if (target) {
      target.status = upd.status;
      target.evidenceIds = [...new Set([...target.evidenceIds, ...upd.evidenceIds])];
    }
  }

  if (worker.result.externalBlocker) {
    task.blocker = {
      type:"EXTERNAL_DEPENDENCY",
      external:true,
      reason:worker.result.externalBlocker.reason
    };
  } else if (task.blocker?.type === "IMPLEMENTATION_INCOMPLETE") {
    task.blocker = null;
  }

  saveTask(state.graphRoot, task);

  return {
    currentNode:"implement",
    acceptance:task.acceptance,
    blocker:task.blocker,
    codexThreadId:worker.threadId,
    codexLastMessage:worker.raw,
    codexResultValid:true
  };
};

const progressNode: GraphNode<typeof EngineeringState> = (state) => {
  const after = diffSnapshot(state.worktreePath);
  const task = taskFromState(state);
  const paths = newlyChangedPaths(state.beforeChangedPaths, changedPaths(state.worktreePath));
  const out = outOfScopePaths(task, paths);
  const immutableMigrations = appliedMigrationDiffs(state.graphRoot, paths);
  if (out.length || immutableMigrations.length) {
    const violations = [
      ...(out.length ? [`Out-of-scope paths: ${out.join(", ")}`] : []),
      ...(immutableMigrations.length ? [`Applied migrations are immutable: ${immutableMigrations.join(", ")}`] : [])
    ];
    return {
      currentNode:"progressGuard",
      blocker:{type:"SAFETY_VIOLATION",external:false,reason:violations.join("; "),evidenceIds:[]},
      findings:[...state.findings,...violations]
    };
  }

  const passCount = state.acceptance.filter((a:any)=>a.status==="PASS").length;
  const noProgress = after.hash === state.beforeDiffHash && passCount === state.beforePassCount && !state.blocker?.external;
  return {
    currentNode:"progressGuard",
    afterDiffHash:after.hash,
    afterPassCount:passCount,
    stallCount:noProgress ? state.stallCount + 1 : 0,
    findings:noProgress ? [...state.findings,"STALL: no diff delta and no acceptance delta."] : state.findings
  };
};

const focusedRetry: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"focusedRetry",
  findings:[...state.findings,"STALL_1: next worker receives only the first incomplete implementation acceptance."]
});

const strategyChange: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"strategyChange",
  findings:[...state.findings,"STALL_2: require alternate implementation strategy before retry."]
});

const humanEscalation: GraphNode<typeof EngineeringState> = (state) => {
  const answer = interrupt({
    type:"AGENT_STALL",
    taskId:state.taskId,
    stallCount:state.stallCount,
    contextPacket:state.contextPacket
  });
  return {
    currentNode:"humanEscalation",
    findings:[...state.findings,`Human strategy response: ${JSON.stringify(answer)}`],
    stallCount:0
  };
};

const staticVerify: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"staticVerify",
  nextLegalAction:"STATIC_VERIFICATION",
  findings:[...state.findings,"Static verification is legal because implementation acceptance is complete."]
});

const targetedVerify: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"targetedVerify",
  nextLegalAction:"TARGETED_VERIFICATION",
  findings:[...state.findings,"Targeted verification node requires task-specific proof commands to mark verification acceptance PASS."]
});

const reviewNode: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"review",
  nextLegalAction:"REVIEW"
});

const productionGate: GraphNode<typeof EngineeringState> = (state) => {
  const answer = interrupt({
    type:"OWNER_PRODUCTION_GATE",
    taskId:state.taskId,
    instruction:"Production SQL/data/schema mutation requires explicit owner authorization."
  });
  return { currentNode:"productionGate", findings:[...state.findings,`Owner gate: ${JSON.stringify(answer)}`] };
};

const completeNode: GraphNode<typeof EngineeringState> = (state) => ({
  currentNode:"complete",
  phase:"COMPLETE",
  canEnd:true,
  nextLegalAction:"END"
});

export function buildGraph(checkpointer:any) {
  return new StateGraph(EngineeringState)
    .addNode("repoPreflight", repoPreflight)
    .addNode("context", contextNode)
    .addNode("barrier", barrierNode)
    .addNode("beforeImplement", beforeNode)
    .addNode("implement", implementNode)
    .addNode("progressGuard", progressNode)
    .addNode("focusedRetry", focusedRetry)
    .addNode("strategyChange", strategyChange)
    .addNode("humanEscalation", humanEscalation)
    .addNode("staticVerify", staticVerify)
    .addNode("targetedVerify", targetedVerify)
    .addNode("review", reviewNode)
    .addNode("productionGate", productionGate)
    .addNode("complete", completeNode)
    .addEdge(START,"repoPreflight")
    .addConditionalEdges("repoPreflight", (s:any) => s.repoHealthy ? "context" : END)
    .addEdge("context","barrier")
    .addConditionalEdges("barrier", (s:any) => {
      const c = completionFlags(s);
      if (!c.implementationComplete) return "beforeImplement";
      if (s.acceptance.some((a:any)=>a.required && a.stage==="VERIFICATION" && a.status!=="PASS")) return "staticVerify";
      if (requiresOwnerProductionGate(s)) return "productionGate";
      return c.canEnd ? "complete" : "beforeImplement";
    })
    .addEdge("beforeImplement","implement")
    .addEdge("implement","progressGuard")
    .addConditionalEdges("progressGuard", (s:any) => {
      if (s.blocker?.type === "SAFETY_VIOLATION") return END;
      if (s.mode === "shadow") return END;
      return nextFromProgress(s);
    })
    .addEdge("focusedRetry","beforeImplement")
    .addEdge("strategyChange","beforeImplement")
    .addEdge("humanEscalation","beforeImplement")
    .addEdge("staticVerify","targetedVerify")
    .addEdge("targetedVerify","review")
    .addEdge("review","barrier")
    .addEdge("productionGate","barrier")
    .addEdge("complete",END)
    .compile({ checkpointer });
}

