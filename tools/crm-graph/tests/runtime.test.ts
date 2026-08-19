import test from "node:test";
import assert from "node:assert/strict";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod/v4";
import { checkpointDiagnostics, executionLimitDiagnostic, graphExecutionPolicy, graphRunConfig } from "../src/runtime.js";

test("graph execution policy has bounded realistic defaults",()=>{
  assert.deepEqual(graphExecutionPolicy({}),{recursionLimit:128,runtimeTimeoutMs:14_400_000});
});

test("graph execution policy accepts bounded configuration",()=>{
  const policy=graphExecutionPolicy({CRM_GRAPH_RECURSION_LIMIT:"256",CRM_GRAPH_RUNTIME_TIMEOUT_MS:"7200000"});
  assert.deepEqual(graphRunConfig("T",policy),{configurable:{thread_id:"T"},recursionLimit:256,timeout:7_200_000});
});

test("graph execution policy rejects unsafe or unrealistic limits",()=>{
  assert.throws(()=>graphExecutionPolicy({CRM_GRAPH_RECURSION_LIMIT:"31"}),/32 through 512/);
  assert.throws(()=>graphExecutionPolicy({CRM_GRAPH_RECURSION_LIMIT:"513"}),/32 through 512/);
  assert.throws(()=>graphExecutionPolicy({CRM_GRAPH_RUNTIME_TIMEOUT_MS:"59999"}),/60000 through 86400000/);
  assert.throws(()=>graphExecutionPolicy({CRM_GRAPH_RUNTIME_TIMEOUT_MS:"86400001"}),/60000 through 86400000/);
});

test("checkpoint diagnostics expose actionable execution state",()=>{
  const tuple:any={config:{configurable:{checkpoint_id:"cp-1"}},checkpoint:{ts:"2026-08-19T00:00:00Z",channel_values:{currentNode:"worker",phase:"IMPLEMENTATION",nextLegalAction:"IMPLEMENT",focusedAcceptanceId:"A08",workerIntent:"IMPLEMENT",workerRetryMode:"FOCUSED_RETRY",workerFailureCount:1,lastWorkerError:{code:"EXIT"}}},metadata:{step:9,source:"loop"},pendingWrites:[["task","__interrupt__",{}],["task","state",{}]]};
  assert.deepEqual(checkpointDiagnostics(tuple),{hasCheckpoint:true,checkpointId:"cp-1",checkpointCreatedAt:"2026-08-19T00:00:00Z",graphStep:9,graphSource:"loop",currentNode:"worker",phase:"IMPLEMENTATION",nextLegalAction:"IMPLEMENT",focusedAcceptanceId:"A08",workerIntent:"IMPLEMENT",workerRetryMode:"FOCUSED_RETRY",workerFailureCount:1,lastWorkerError:{code:"EXIT"},pendingWrites:2,pendingInterrupts:1});
});

test("execution limit diagnostics distinguish timeout and recursion",()=>{
  const policy=graphExecutionPolicy({});
  const timeout=executionLimitDiagnostic("T",policy,Object.assign(new Error("operation timed out"),{name:"TimeoutError"}),null);
  const recursion=executionLimitDiagnostic("T",policy,Object.assign(new Error("steps"),{name:"GraphRecursionError"}),null);
  assert.equal(timeout?.kind,"RUNTIME_TIMEOUT");assert.match(timeout?.nextRequiredAction ?? "",/--continue/);
  assert.equal(recursion?.kind,"RECURSION_LIMIT");assert.match(recursion?.nextRequiredAction ?? "",/CRM_GRAPH_RECURSION_LIMIT/);
});

test("configured recursion limit is enforced by graph execution",async()=>{
  const State=new StateSchema({count:z.number().int().default(0)});
  const graph=new StateGraph(State).addNode("loop",state=>({count:state.count+1})).addEdge(START,"loop").addEdge("loop","loop").compile();
  await assert.rejects(graph.invoke({count:0},graphRunConfig("T",{recursionLimit:32,runtimeTimeoutMs:60_000})),(error:any)=>error?.name==="GraphRecursionError");
});

test("configured whole-run timeout aborts active graph work",async()=>{
  const State=new StateSchema({done:z.boolean().default(false)});
  const graph=new StateGraph(State).addNode("slow",async(_state,config)=>{
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(resolve,5_000);
      config.signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(config.signal?.reason);},{once:true});
    });
    return {done:true};
  }).addEdge(START,"slow").addEdge("slow",END).compile();
  await assert.rejects(graph.invoke({done:false},graphRunConfig("T",{recursionLimit:32,runtimeTimeoutMs:25})),(error:any)=>executionLimitDiagnostic("T",{recursionLimit:32,runtimeTimeoutMs:25},error,null)?.kind==="RUNTIME_TIMEOUT");
});
