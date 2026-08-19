import fs from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { loadTask } from "./loader.js";
import { compileContext, writeContextProjection } from "./context.js";
import { inspectRepo } from "./git.js";
import { buildRepoIndex } from "./repo-index.js";
import { buildGraph } from "./graph.js";

function arg(name:string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i+1] : undefined;
}

function findGraphRoot(start: string) {
  let candidate = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(candidate, ".crm-engineering", "manifest.json"))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error("Unable to find .crm-engineering/manifest.json; pass --root <repository-root>.");
    candidate = parent;
  }
}

const command = process.argv[2];
// npm --prefix runs package scripts from tools/crm-graph. Discover the graph
// repository instead of treating that package directory as the repository root.
const root = findGraphRoot(arg("--root") ?? process.cwd());
const taskId = arg("--task");

function needTask() {
  if (!taskId) throw new Error("--task <TASK_ID> is required");
  return loadTask(root, taskId);
}

if (command === "status") {
  const task = needTask();
  const repo = task.repository.worktreePath ? inspectRepo(task.repository.worktreePath) : null;
  console.log(JSON.stringify({
    taskId:task.taskId,
    objective:task.objective,
    phase:task.phase,
    repository:task.repository,
    repo,
    acceptance:task.acceptance,
    blocker:task.blocker
  }, null, 2));
} else if (command === "context") {
  const task = needTask();
  const p = writeContextProjection(root, task);
  console.log(p);
  console.log(compileContext(root, task));
} else if (command === "index") {
  const idx = buildRepoIndex(root);
  const dir = path.join(root, ".crm-engineering","generated");
  fs.mkdirSync(dir,{recursive:true});
  const p = path.join(dir,"repo-graph.json");
  fs.writeFileSync(p, JSON.stringify(idx,null,2));
  console.log(p);
} else if (command === "shadow" || command === "run") {
  const task = needTask();
  if (!task.repository.worktreePath) throw new Error("Task worktreePath is null. Repository recovery is required first.");

  const runtime = path.join(root, ".crm-engineering","runtime");
  fs.mkdirSync(runtime,{recursive:true});
  const saver = SqliteSaver.fromConnString(path.join(runtime,"engineering-state.sqlite"));
  const graph = buildGraph(saver);

  const initial:any = {
    graphSchemaVersion:task.graphSchemaVersion,
    flowVersion:task.flowVersion,
    taskId:task.taskId,
    objective:task.objective,
    mode:command === "run" ? "enforce" : "shadow",
    canonicalRoot:task.repository.canonicalRoot,
    graphRoot:root,
    worktreePath:task.repository.worktreePath,
    branch:task.repository.branch,
    expectedBaseRef:task.repository.expectedBaseRef,
    expectedBaseSha:task.repository.expectedBaseSha,
    observedHeadSha:task.repository.observedHeadSha,
    dirtyBaselineHash:task.repository.dirtyBaselineHash,
    risk:task.risk,
    domains:task.domains,
    allowedPaths:task.allowedPaths,
    protectedDomains:task.protectedDomains,
    phase:task.phase,
    acceptance:task.acceptance,
    blocker:task.blocker,
    currentNode:"START",
    nextLegalAction:"",
    contextPacket:"",
    repoHealthy:false,
    implementationComplete:false,
    broadVerificationAllowed:false,
    canEnd:false,
    beforeDiffHash:null,
    beforeChangedPaths:[],
    afterDiffHash:null,
    beforePassCount:0,
    afterPassCount:0,
    stallCount:0,
    codexThreadId:null,
    codexLastMessage:"",
    codexResultValid:false,
    findings:[]
  };

  const result = await graph.invoke(initial, {
    configurable:{ thread_id:task.taskId },
    recursionLimit:30
  });
  console.log(JSON.stringify(result,null,2));
} else {
  console.log("Commands: status | context | index | shadow | run");
  process.exitCode = 2;
}
