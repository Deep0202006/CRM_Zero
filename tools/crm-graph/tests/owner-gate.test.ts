import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { authorizeOwnerMigrationReadiness, OWNER_MIGRATION_READINESS_PHRASE, rejectWorkerOwnerMigrationReadiness, type RemoteReleaseFacts } from "../src/owner-gate.js";

function git(root:string,...args:string[]) { return execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim(); }
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"crm-owner-gate-"));
  git(root,"init","-b","main"); git(root,"config","user.email","gate@test.invalid"); git(root,"config","user.name","Gate Test");
  for(const dir of [".crm-engineering/tasks",".crm-engineering/policy",".crm-engineering/proofs/T","supabase/migrations"]) fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,".crm-engineering/policy/applied-migrations.json"),'{"immutableThrough":44}');
  git(root,"add","."); git(root,"commit","--allow-empty","-m","base");
  const baseSha=git(root,"rev-parse","HEAD");
  const migration="select 45;\n";
  fs.writeFileSync(path.join(root,"supabase/migrations/045_test.sql"),migration);
  const task:any={schemaVersion:2,graphSchemaVersion:1,flowVersion:"1.3.1",taskId:"T",risk:"R2",phase:"PRODUCTION_GATE",blocker:null,
    repository:{canonicalRoot:root,worktreePath:root,branch:"main",expectedBaseRef:"HEAD",expectedBaseSha:baseSha,observedHeadSha:null,dirtyBaselineHash:"baseline"},
    productionDataMutation:false,schemaChange:true,humanGate:{kind:"OWNER_PRODUCTION_GATE",status:"PENDING",reason:"manual"},acceptance:[
    {id:"I",stage:"IMPLEMENTATION",status:"PASS",required:true,evidenceIds:[]},
    {id:"V",stage:"VERIFICATION",status:"PASS",required:true,evidenceIds:[".crm-engineering/proofs/T/release.json"]},
    {id:"R",stage:"RELEASE",status:"PENDING",required:true,evidenceIds:[]}
  ]};
  fs.writeFileSync(path.join(root,".crm-engineering/tasks/T.json"),JSON.stringify(task));
  git(root,"add",".crm-engineering/tasks/T.json","supabase/migrations/045_test.sql"); git(root,"commit","-m","task and migration");
  const remoteHead=git(root,"rev-parse","HEAD");
  const proof:any={schemaVersion:1,kind:"OWNER_MIGRATION_READINESS_CERTIFICATION",taskId:"T",repository:{remotePrHead:remoteHead,certifiedHead:remoteHead,baseSha},requiredChecks:[{name:"verify",status:"PASS"},{name:"database",status:"PASS"}],vercel:{status:"READY",head:remoteHead},migration:{path:"supabase/migrations/045_test.sql",number:45,sha256:crypto.createHash("sha256").update(migration).digest("hex")},immutablePolicy:{immutableThrough:44}};
  const proofPath=path.join(root,".crm-engineering/proofs/T/release.json"); fs.writeFileSync(proofPath,JSON.stringify(proof));
  git(root,"add",proofPath);git(root,"commit","-m","certification");
  const finalHead=git(root,"rev-parse","HEAD");
  const remote:RemoteReleaseFacts={pr:{head:finalHead,base:baseSha,state:"OPEN"},requiredChecks:[{name:"verify",status:"pass"},{name:"receivables-postgres",status:"pass"},{name:"e2e",status:"pass"}],vercel:{status:"pass",head:finalHead}};
  return {root,task,proofPath,remote};
}

test("eligible exact-head remote evidence authorizes the canonical readiness phrase",()=>{const f=fixture();assert.equal(authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),OWNER_MIGRATION_READINESS_PHRASE);});
test("release-critical equality is structural and does not depend on JSON object key order",()=>{
  const f=fixture();
  f.task.repository=Object.fromEntries(Object.entries(f.task.repository).reverse());
  f.task.humanGate=Object.fromEntries(Object.entries(f.task.humanGate).reverse());
  assert.equal(authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),OWNER_MIGRATION_READINESS_PHRASE);
});
test("production gate requires exact local and HEAD release-critical task state",()=>{
  const mutations:Array<{mutate:(task:any)=>void;error:RegExp}> = [
    {mutate:task=>task.phase="RELEASE",error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.blocker={type:"HUMAN_APPROVAL_REQUIRED",external:true,reason:"changed"},error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.humanGate.status="APPROVED",error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.repository.branch="changed",error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.productionDataMutation=true,error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.schemaChange=false,error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.acceptance[0].status="FAIL",error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/},
    {mutate:task=>task.acceptance[1].evidenceIds=[".crm-engineering/proofs/T/other.json"],error:/OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH/}
  ];
  for (const {mutate,error} of mutations) {
    const f=fixture();
    mutate(f.task);
    assert.throws(()=>authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),error);
  }
});
test("production gate fails closed for every remote release prerequisite",()=>{
  for(const mutate of [
    (r:RemoteReleaseFacts)=>r.pr.head="stale",
    (r:RemoteReleaseFacts)=>r.pr.base="stale",
    (r:RemoteReleaseFacts)=>r.pr.state="CLOSED",
    (r:RemoteReleaseFacts)=>r.requiredChecks[0].status="fail",
    (r:RemoteReleaseFacts)=>r.requiredChecks=r.requiredChecks.filter(check=>check.name!=="e2e"),
    (r:RemoteReleaseFacts)=>r.requiredChecks=[],
    (r:RemoteReleaseFacts)=>r.vercel.status="fail",
    (r:RemoteReleaseFacts)=>r.vercel.head="stale"
  ]){
    const f=fixture();mutate(f.remote);assert.throws(()=>authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),/OWNER_GATE_/);
  }
});
test("mutable local certification cannot self-authorize remote release facts",()=>{
  const f=fixture();
  const local=JSON.parse(fs.readFileSync(f.proofPath,"utf8"));
  local.requiredChecks=[{name:"forged",status:"PASS"}];local.vercel={status:"READY",head:f.remote.pr.head};local.migration.sha256="0".repeat(64);
  fs.writeFileSync(f.proofPath,JSON.stringify(local));
  assert.equal(authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),OWNER_MIGRATION_READINESS_PHRASE);
  f.remote.requiredChecks[0].status="fail";
  assert.throws(()=>authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),/OWNER_GATE_REQUIRED_CHECKS_NOT_GREEN/);
});
test("migration hash and immutable boundary come from committed HEAD and base objects",()=>{
  const f=fixture();
  fs.writeFileSync(path.join(f.root,"supabase/migrations/045_test.sql"),"forged local migration\n");
  fs.writeFileSync(path.join(f.root,".crm-engineering/policy/applied-migrations.json"),'{"immutableThrough":0}');
  assert.equal(authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),OWNER_MIGRATION_READINESS_PHRASE);
  const proof=JSON.parse(git(f.root,"show","HEAD:.crm-engineering/proofs/T/release.json"));proof.migration.sha256="0".repeat(64);
  fs.writeFileSync(f.proofPath,JSON.stringify(proof));git(f.root,"add",f.proofPath);git(f.root,"commit","-m","bad committed hash");
  const head=git(f.root,"rev-parse","HEAD");f.remote.pr.head=head;f.remote.vercel.head=head;
  assert.throws(()=>authorizeOwnerMigrationReadiness(f.root,f.task,()=>f.remote),/OWNER_GATE_MIGRATION_HASH_MISMATCH/);
});
test("worker output cannot emit the controller readiness phrase",()=>{assert.throws(()=>rejectWorkerOwnerMigrationReadiness({summary:OWNER_MIGRATION_READINESS_PHRASE}),/FORBIDDEN/);assert.doesNotThrow(()=>rejectWorkerOwnerMigrationReadiness({summary:"Implementation complete."}));});
test("owner-gate controller is the only source phrase emitter",()=>{
  const sourceRoot=path.join(import.meta.dirname,"..","src");
  const extension=path.extname(import.meta.filename);
  const emitters=fs.readdirSync(sourceRoot).filter(name=>name.endsWith(extension) && fs.readFileSync(path.join(sourceRoot,name),"utf8").includes("OWNER_MIGRATION_READY:"));
  assert.deepEqual(emitters,[`owner-gate${extension}`]);
});
