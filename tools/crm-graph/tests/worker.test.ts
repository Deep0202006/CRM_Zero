import test from "node:test";
import assert from "node:assert/strict";
import { CodexWorkerSession, extractWorkerJson, loadSavedCodexThreadId, validateWorkerResult, WorkerResultError } from "../src/worker.js";

function task(overrides:any={}) { return {
  schemaVersion:2,graphSchemaVersion:1,flowVersion:"1.1.0",taskId:"T",objective:"test",risk:"R0",domains:["engineering-graph"],
  repository:{canonicalRoot:"C:\\repo",worktreePath:"C:\\repo",branch:"b",expectedBaseRef:"origin/main",expectedBaseSha:"a",observedHeadSha:"a",dirtyBaselineHash:"h"},
  phase:"IMPLEMENTATION",allowedPaths:[".crm-engineering/**"],protectedDomains:[],productionDataMutation:false,schemaChange:false,humanGate:null,
  acceptance:[{id:"A",description:"do it",stage:"IMPLEMENTATION",status:"PENDING",required:true,evidenceIds:[]}],blocker:null,...overrides
} as any; }

class FakeServer {
  initialized=0; started=0; resumed=0; turns=0; closed=0; resumedIds:string[]=[]; turnThreadIds:string[]=[];
  prompts:string[]=[];
  async initialize(){this.initialized++;}
  async startThread(){this.started++;return "new-thread";}
  async resumeThread(id:string){this.resumed++;this.resumedIds.push(id);return id;}
  async runTurn(id:string,_cwd?:string,prompt?:string){this.turns++;this.turnThreadIds.push(id);this.prompts.push(prompt ?? "");return {text:'{"taskId":"T","acceptanceUpdates":[{"id":"A","status":"PASS","evidenceIds":["test:ok"]}],"changedPaths":[],"externalBlocker":null,"summary":"ok"}',turn:{}};}
  close(){this.closed++;}
}

test("worker extracts direct JSON",()=>assert.equal(extractWorkerJson('{"taskId":"T"}' as any).taskId,"T"));
test("worker extracts fenced surrounding JSON",()=>assert.equal(extractWorkerJson('text {"taskId":"T"} end' as any).taskId,"T"));
test("worker rejects absent JSON",()=>assert.throws(()=>extractWorkerJson("none"),/MALFORMED_RESULT/));
test("worker validates exact task id",()=>assert.throws(()=>validateWorkerResult(task(),{taskId:"X",acceptanceUpdates:[],changedPaths:[],externalBlocker:null,summary:""}),/TASK_MISMATCH/));
test("worker rejects unknown acceptance id",()=>assert.throws(()=>validateWorkerResult(task(),{taskId:"T",acceptanceUpdates:[{id:"X",status:"PASS",evidenceIds:["x"]}],changedPaths:[],externalBlocker:null,summary:""}),/UNKNOWN_ACCEPTANCE/));
test("worker PASS requires evidence",()=>assert.throws(()=>validateWorkerResult(task(),{taskId:"T",acceptanceUpdates:[{id:"A",status:"PASS",evidenceIds:[]}],changedPaths:[],externalBlocker:null,summary:""}),/EVIDENCE_REQUIRED/));
test("worker rejects malformed external blocker with a typed error before state mutation",()=>assert.throws(()=>validateWorkerResult(task(),{taskId:"T",acceptanceUpdates:[{id:"A",status:"PENDING",evidenceIds:[]}],changedPaths:[],externalBlocker:{} as any,summary:"partial"}),(error:unknown)=>error instanceof WorkerResultError && error.code === "CODEX_WORKER_MALFORMED_EXTERNAL_BLOCKER"));
test("worker accepts an external blocker only with a durable reason",()=>assert.doesNotThrow(()=>validateWorkerResult(task(),{taskId:"T",acceptanceUpdates:[{id:"A",status:"PENDING",evidenceIds:[]}],changedPaths:[],externalBlocker:{reason:"Disposable PostgreSQL is unavailable"},summary:"partial"})));

test("worker result is bound to exactly the focused acceptance",()=>{
  const t=task({acceptance:[
    {id:"A",description:"implement",stage:"IMPLEMENTATION",status:"PENDING",required:true,evidenceIds:[]},
    {id:"V",description:"verify",stage:"VERIFICATION",status:"PENDING",required:true,evidenceIds:[]}
  ]});
  assert.throws(()=>validateWorkerResult(t,{taskId:"T",acceptanceUpdates:[{id:"V",status:"PASS",evidenceIds:["test:v"]}],changedPaths:[],externalBlocker:null,summary:""},t.acceptance[0],"IMPLEMENT"),/FOCUSED_ACCEPTANCE_MISMATCH/);
});

test("verification validation fails while required implementation remains incomplete",()=>{
  const t=task({acceptance:[
    {id:"A",description:"implement",stage:"IMPLEMENTATION",status:"PENDING",required:true,evidenceIds:[]},
    {id:"V",description:"verify",stage:"VERIFICATION",status:"PENDING",required:true,evidenceIds:[]}
  ]});
  assert.throws(()=>validateWorkerResult(t,{taskId:"T",acceptanceUpdates:[{id:"V",status:"PASS",evidenceIds:["test:v"]}],changedPaths:[],externalBlocker:null,summary:""},t.acceptance[1],"VERIFY"),/VERIFICATION_BEFORE_IMPLEMENTATION/);
});

test("same App Server and live thread are reused across turns",async()=>{
  const fake=new FakeServer(); const session=new CodexWorkerSession(()=>fake as any); const t=task();
  await session.run(t,"ctx","IMPLEMENT",t.acceptance[0]); await session.run(t,"ctx","IMPLEMENT",t.acceptance[0],"ignored-old");
  assert.deepEqual({initialized:fake.initialized,started:fake.started,resumed:fake.resumed,turns:fake.turns},{initialized:1,started:1,resumed:0,turns:2});
  session.close(); assert.equal(fake.closed,1); session.close(); assert.equal(fake.closed,1);
});

test("worker sends full digest-bound context once then a substantially smaller unchanged marker",async()=>{
  const fake=new FakeServer(); const session=new CodexWorkerSession(()=>fake as any); const t=task();
  const context=`WORKER_CONTEXT\n${"canonical context ".repeat(400)}`;
  await session.run(t,context,"IMPLEMENT",t.acceptance[0]);
  await session.run(t,context,"IMPLEMENT",t.acceptance[0]);
  assert.match(fake.prompts[0],/CONTEXT_DIGEST [a-f0-9]{64}\nWORKER_CONTEXT/);
  assert.match(fake.prompts[1],/CONTEXT_DIGEST [a-f0-9]{64} UNCHANGED/);
  assert.doesNotMatch(fake.prompts[1],/WORKER_CONTEXT/);
  assert.ok(fake.prompts[1].length < fake.prompts[0].length * 0.25,`expected repeated prompt ${fake.prompts[1].length} to be <25% of initial ${fake.prompts[0].length}`);
  assert.match(fake.prompts[0],/Work only on acceptance A: do it/);
  assert.match(fake.prompts[1],/Work only on acceptance A: do it/);
  session.close();
});

test("materially changed context is sent in full once",async()=>{
  const fake=new FakeServer(); const session=new CodexWorkerSession(()=>fake as any); const t=task();
  await session.run(t,"context-v1","IMPLEMENT",t.acceptance[0]);
  await session.run(t,"context-v2","IMPLEMENT",t.acceptance[0]);
  assert.match(fake.prompts[0],/CONTEXT_DIGEST [a-f0-9]{64}\ncontext-v1/);
  assert.match(fake.prompts[1],/CONTEXT_DIGEST [a-f0-9]{64}\ncontext-v2/);
  assert.doesNotMatch(fake.prompts[1],/UNCHANGED/);
  session.close();
});

test("new process explicitly resumes saved Codex thread",async()=>{
  const fake=new FakeServer(); const session=new CodexWorkerSession(()=>fake as any); const t=task();
  const result=await session.run(t,"ctx","IMPLEMENT",t.acceptance[0],"saved-thread");
  assert.equal(result.threadId,"saved-thread"); assert.equal(fake.resumed,1); assert.equal(fake.started,0);
  assert.match(fake.prompts[0],/CONTEXT_DIGEST [a-f0-9]{64}\nctx/);
  assert.match(fake.prompts[0],/Work only on acceptance A: do it/);
  session.close();
});

test("restart loads durable Codex thread id from the graph checkpoint and resumes it",async()=>{
  const checkpointer={async getTuple(config:any){
    assert.equal(config.configurable.thread_id,"T");
    return {checkpoint:{channel_values:{codexThreadId:"durable-thread"}}};
  }};
  const saved=await loadSavedCodexThreadId(checkpointer,"T");
  const fake=new FakeServer(); const restartedSession=new CodexWorkerSession(()=>fake as any); const t=task();
  const result=await restartedSession.run(t,"ctx","IMPLEMENT",t.acceptance[0],saved);
  assert.equal(result.threadId,"durable-thread");
  assert.deepEqual({resumedIds:fake.resumedIds,turnThreadIds:fake.turnThreadIds,started:fake.started},{resumedIds:["durable-thread"],turnThreadIds:["durable-thread"],started:0});
  restartedSession.close();
});

test("invalid saved Codex thread ids fail closed",async()=>{
  const checkpointer={async getTuple(){return {checkpoint:{channel_values:{codexThreadId:""}}};}};
  await assert.rejects(loadSavedCodexThreadId(checkpointer,"T"),/INVALID_SAVED_THREAD/);
});

test("focused retry and strategy change are explicit in continuation prompts",async()=>{
  const fake=new FakeServer(); const session=new CodexWorkerSession(()=>fake as any); const t=task();
  const prompts:string[]=[]; fake.runTurn=async function(id:string,_cwd?:string,prompt?:string){this.turns++;this.turnThreadIds.push(id);prompts.push(prompt ?? "");return {text:'{"taskId":"T","acceptanceUpdates":[{"id":"A","status":"PASS","evidenceIds":["test:ok"]}],"changedPaths":[],"externalBlocker":null,"summary":"ok"}',turn:{}};};
  await session.run(t,"ctx","IMPLEMENT",t.acceptance[0],null,{retryMode:"FOCUSED_RETRY",failureCount:1,previousError:{code:"CODEX_APP_SERVER_EXIT",message:"exit",attempt:1}});
  await session.run(t,"ctx","IMPLEMENT",t.acceptance[0],null,{retryMode:"STRATEGY_CHANGE",failureCount:2,previousError:{code:"CODEX_APP_SERVER_EXIT",message:"exit",attempt:2},strategyGuidance:"avoid prior transport path"});
  assert.match(prompts[0],/Focused retry 2.*CODEX_APP_SERVER_EXIT/);
  assert.match(prompts[1],/Strategy-change retry 3.*materially different.*avoid prior transport path/);
  session.close();
});
