import fs from "node:fs";
import path from "node:path";
import { Command } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { loadTask, saveTask } from "./loader.js";
import { compileContext, writeContextProjection } from "./context.js";
import { buildRepoIndex } from "./repo-index.js";
import { buildGraph } from "./graph.js";
import { bindTaskRepository } from "./binding.js";
import { CodexWorkerSession, loadSavedCodexThreadId } from "./worker.js";
import { parseResumeEnvelope, pendingHumanInterrupt, resumeFileTemplate } from "./resume.js";
import { checkpointDiagnostics, executionLimitDiagnostic, graphExecutionPolicy, graphRunConfig } from "./runtime.js";
import { inspectBoundRepository } from "./status.js";

function arg(name:string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index+1] : undefined; }
function findGraphRoot(start:string) {
  let candidate = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(candidate,".crm-engineering","manifest.json"))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error("Unable to find .crm-engineering/manifest.json; pass --root <repository-root>.");
    candidate = parent;
  }
}
const command = process.argv[2];
const root = findGraphRoot(arg("--root") ?? process.cwd());
const taskId = arg("--task");
function needTask() { if (!taskId) throw new Error("--task <TASK_ID> is required"); return loadTask(root,taskId); }
function runtimePath() { return path.join(root,".crm-engineering","runtime","engineering-state.sqlite"); }
function saver() {
  const runtime = path.dirname(runtimePath());
  fs.mkdirSync(runtime,{recursive:true});
  return SqliteSaver.fromConnString(runtimePath());
}

if (command === "bind") {
  const task = needTask();
  const worktree = arg("--worktree");
  if (!worktree) throw new Error("--worktree <PATH> is required");
  const result = bindTaskRepository(task,worktree);
  saveTask(root,task);
  console.log(JSON.stringify({taskId:task.taskId,...result},null,2));
} else if (command === "status") {
  const task = needTask();
  const {repo,repositoryDiagnostic}=inspectBoundRepository(task.repository.worktreePath);
  let checkpoint:any = null;
  if (fs.existsSync(runtimePath())) {
    const checkpointer:any = saver();
    const tuple = await checkpointer.getTuple({ configurable:{thread_id:task.taskId} });
    checkpoint = checkpointDiagnostics(tuple);
  }
  const implementationIncomplete = task.acceptance.filter(item=>item.required && item.stage === "IMPLEMENTATION" && item.status !== "PASS").map(item=>item.id);
  const verificationIncomplete = task.acceptance.filter(item=>item.required && item.stage === "VERIFICATION" && item.status !== "PASS").map(item=>item.id);
  const releaseIncomplete = task.acceptance.filter(item=>item.required && item.stage === "RELEASE" && item.status !== "PASS").map(item=>item.id);
  console.log(JSON.stringify({
    taskId:task.taskId, objective:task.objective, phase:task.phase, repository:task.repository, repo, repositoryDiagnostic,
    dirtyFingerprintMatches:repo ? repo.dirtyHash === task.repository.dirtyBaselineHash : false,
    implementationIncomplete, verificationIncomplete, releaseIncomplete,
    acceptance:task.acceptance, blocker:task.blocker, limits:graphExecutionPolicy(), checkpoint,
    nextLegalAction:implementationIncomplete.length ? "IMPLEMENT" : verificationIncomplete.length ? "VERIFY" : releaseIncomplete.length ? "OWNER_PRODUCTION_GATE" : "END"
  },null,2));
} else if (command === "context") {
  const task = needTask();
  const projection = writeContextProjection(root,task);
  console.log(projection);
  console.log(compileContext(root,task));
} else if (command === "index") {
  const index = buildRepoIndex(root);
  const dir = path.join(root,".crm-engineering","generated");
  fs.mkdirSync(dir,{recursive:true});
  const output = path.join(dir,"repo-graph.json");
  fs.writeFileSync(output,JSON.stringify(index,null,2));
  console.log(output);
} else if (command === "shadow" || command === "run") {
  const task = needTask();
  if (!task.repository.worktreePath) throw new Error("Task worktreePath is null. Repository recovery is required first.");
  const checkpointer = saver();
  const session = new CodexWorkerSession();
  const graph = buildGraph(checkpointer,session);
  const executionPolicy = graphExecutionPolicy();
  const config = graphRunConfig(task.taskId,executionPolicy);
  const resumeFile = arg("--resume-file");
  const continueCheckpoint = process.argv.includes("--continue");
  if (resumeFile && continueCheckpoint) throw new Error("Use either --resume-file or --continue, not both.");
  let input:any;
  if (resumeFile) {
    const pending = await pendingHumanInterrupt(graph,config);
    const envelope = JSON.parse(fs.readFileSync(path.resolve(resumeFile),"utf8"));
    const payload = parseResumeEnvelope(envelope,task.taskId,pending.type);
    input = new Command({resume:payload});
  } else if (continueCheckpoint) {
    const tuple = await checkpointer.getTuple({configurable:{thread_id:task.taskId}});
    if (!tuple) throw new Error(`GRAPH_CHECKPOINT_NOT_FOUND: ${task.taskId}`);
    input = null;
  } else {
    const savedCodexThreadId = await loadSavedCodexThreadId(checkpointer,task.taskId);
    input = {
      graphSchemaVersion:task.graphSchemaVersion, flowVersion:task.flowVersion, taskId:task.taskId, objective:task.objective,
      mode:command === "run" ? "enforce" : "shadow", canonicalRoot:task.repository.canonicalRoot, graphRoot:root,
      worktreePath:task.repository.worktreePath, branch:task.repository.branch, expectedBaseRef:task.repository.expectedBaseRef,
      expectedBaseSha:task.repository.expectedBaseSha, observedHeadSha:task.repository.observedHeadSha, dirtyBaselineHash:task.repository.dirtyBaselineHash,
      risk:task.risk, domains:task.domains, allowedPaths:task.allowedPaths, protectedDomains:task.protectedDomains,
      phase:task.phase, acceptance:task.acceptance, blocker:task.blocker, currentNode:"START", nextLegalAction:"", contextPacket:"",
      repoHealthy:false, implementationComplete:false, broadVerificationAllowed:false, canEnd:false,
      beforeDiffHash:null, beforeChangedPaths:[], afterDiffHash:null, beforePassCount:0, afterPassCount:0, stallCount:0,
      workerIntent:"IMPLEMENT", focusedAcceptanceId:null, workerRetryMode:"INITIAL", workerFailureCount:0,
      workerErrorHistory:[], workerStrategyGuidance:null,
      codexThreadId:savedCodexThreadId, codexLastMessage:"", codexResultValid:false,
      lastWorkerError:null, findings:[]
    };
  }
  try {
    let result:any;
    try {
      result = await graph.invoke(input,config);
    } catch (error:any) {
      const tuple = await checkpointer.getTuple({configurable:{thread_id:task.taskId}});
      const diagnostic = executionLimitDiagnostic(task.taskId,executionPolicy,error,tuple);
      if (!diagnostic) throw error;
      console.error(JSON.stringify(diagnostic,null,2));
      process.exitCode = 1;
      result = null;
    }
    if (result && Array.isArray(result?.__interrupt__) && result.__interrupt__.length) {
      const value = result.__interrupt__[0]?.value ?? result.__interrupt__[0];
      const type = value?.type === "AGENT_STALL" ? "AGENT_STALL" : "OWNER_PRODUCTION_GATE";
      console.log(JSON.stringify({status:"INTERRUPTED",taskId:task.taskId,thread_id:task.taskId,type,payload:value,nextRequiredHumanAction:value?.instruction ?? "Provide a structured --resume-file payload.",resumeFileTemplate:resumeFileTemplate(task.taskId,type)},null,2));
    } else if (result) console.log(JSON.stringify(result,null,2));
  } finally {
    session.close();
  }
} else {
  console.log("Commands: bind | status | context | index | shadow | run");
  process.exitCode = 2;
}
