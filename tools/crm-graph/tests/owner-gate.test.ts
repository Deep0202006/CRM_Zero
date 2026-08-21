import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { authorizeOwnerMigrationReadiness, OWNER_MIGRATION_READINESS_PHRASE, rejectWorkerOwnerMigrationReadiness } from "../src/owner-gate.js";

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
  const task:any={taskId:"T",repository:{expectedBaseSha:baseSha},humanGate:{kind:"OWNER_PRODUCTION_GATE",status:"PENDING",reason:"manual"},acceptance:[
    {id:"I",stage:"IMPLEMENTATION",status:"PASS",required:true,evidenceIds:[]},
    {id:"V",stage:"VERIFICATION",status:"PASS",required:true,evidenceIds:[".crm-engineering/proofs/T/release.json"]},
    {id:"R",stage:"RELEASE",status:"PENDING",required:true,evidenceIds:[]}
  ]};
  fs.writeFileSync(path.join(root,".crm-engineering/tasks/T.json"),JSON.stringify(task));
  git(root,"add",".crm-engineering/tasks/T.json","supabase/migrations/045_test.sql"); git(root,"commit","-m","task and migration");
  const remoteHead=git(root,"rev-parse","HEAD");
  const proof:any={schemaVersion:1,kind:"OWNER_MIGRATION_READINESS_CERTIFICATION",taskId:"T",repository:{remotePrHead:remoteHead,certifiedHead:remoteHead,baseSha},requiredChecks:[{name:"verify",status:"PASS"},{name:"database",status:"PASS"}],vercel:{status:"READY",head:remoteHead},migration:{path:"supabase/migrations/045_test.sql",number:45,sha256:crypto.createHash("sha256").update(migration).digest("hex")},immutablePolicy:{immutableThrough:44}};
  const proofPath=path.join(root,".crm-engineering/proofs/T/release.json"); fs.writeFileSync(proofPath,JSON.stringify(proof));
  return {root,task,proofPath};
}

test("eligible exact-head evidence authorizes the canonical readiness phrase",()=>{const f=fixture();assert.equal(authorizeOwnerMigrationReadiness(f.root,f.task),OWNER_MIGRATION_READINESS_PHRASE);});
test("production gate fails closed for every remote and migration prerequisite",()=>{
  for(const mutate of [(p:any)=>p.repository.remotePrHead="stale",(p:any)=>p.requiredChecks[0].status="FAIL",(p:any)=>p.vercel.status="ERROR",(p:any)=>p.migration.sha256="0".repeat(64),(p:any)=>p.immutablePolicy.immutableThrough=43]){
    const f=fixture();const proof=JSON.parse(fs.readFileSync(f.proofPath,"utf8"));mutate(proof);fs.writeFileSync(f.proofPath,JSON.stringify(proof));assert.throws(()=>authorizeOwnerMigrationReadiness(f.root,f.task),/OWNER_GATE_/);
  }
});
test("worker output cannot emit the controller readiness phrase",()=>{assert.throws(()=>rejectWorkerOwnerMigrationReadiness({summary:OWNER_MIGRATION_READINESS_PHRASE}),/FORBIDDEN/);assert.doesNotThrow(()=>rejectWorkerOwnerMigrationReadiness({summary:"Implementation complete."}));});
