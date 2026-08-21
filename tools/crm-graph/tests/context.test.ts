import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { compileContext, compileWorkerContext } from "../src/context.js";

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"crm-worker-context-"));
  const knowledge=path.join(root,".crm-engineering","knowledge");
  const policy=path.join(root,".crm-engineering","policy");
  fs.mkdirSync(knowledge,{recursive:true}); fs.mkdirSync(policy,{recursive:true});
  fs.writeFileSync(path.join(knowledge,"authority-registry.json"),JSON.stringify({facts:[
    {id:"distributor_account",authority:"public.distributor_accounts",owns:["distributor status"]},
    {id:"pipeline_lead",authority:"public.leads",owns:["pipeline"]}
  ]}));
  fs.writeFileSync(path.join(knowledge,"capability-registry.json"),JSON.stringify({capabilities:[
    {id:"distributor-import",status:"PRODUCTION_CERTIFIED",authorityRefs:["distributor_account"]},
    {id:"pipeline-transition",status:"PRODUCTION_CERTIFIED",authorityRefs:["pipeline_lead"]}
  ]}));
  fs.writeFileSync(path.join(knowledge,"lessons-registry.json"),JSON.stringify({lessons:[
    {id:"DISTRIBUTOR_EXACT_KEY",domain:"Distributor Status",rule:"Use exact distributor keys."},
    {id:"PIPELINE_ONLY",domain:"Pipeline",rule:"Unrelated pipeline-only knowledge."},
    {id:"EXACT_HEAD_PROOF_REUSE_RULE",domain:"Execution management",rule:"Reuse exact-head proof."},
    {id:"LOCAL_EPHEMERAL_DB_TOOLCHAIN_RULE",domain:"Local database verification",rule:"Reuse CI toolchains."},
    {id:"REMOTE_RELEASE_EVIDENCE_RULE",domain:"Release governance",rule:"Controller-only release evidence.",workerContext:false},
    {id:"EXTRA_DISTRIBUTOR",domain:"Distributor Status",rule:"Another relevant lesson."}
  ]}));
  fs.writeFileSync(path.join(policy,"context-policy.json"),JSON.stringify({workerContext:{maxLessons:4,mandatoryLessonIds:["EXACT_HEAD_PROOF_REUSE_RULE","LOCAL_EPHEMERAL_DB_TOOLCHAIN_RULE"]}}));
  return root;
}

test("worker context is stable, bounded, relevant, and omits completed acceptance evidence",()=>{
  const root=fixture();
  try {
    const task:any={taskId:"T",objective:"Improve Distributor Status import",risk:"R1",domains:["distributor-status"],repository:{worktreePath:root,branch:"feature",expectedBaseRef:"origin/main",expectedBaseSha:"abc"},allowedPaths:["src/lib/distributors/**"],protectedDomains:["pipeline"],productionDataMutation:false,schemaChange:false,acceptance:[{id:"DONE",description:"completed secret description",status:"PASS",evidenceIds:["historical:evidence"]}]};
    const first=compileWorkerContext(root,task); const second=compileWorkerContext(root,task);
    assert.equal(first.digest,second.digest);
    assert.deepEqual(first.authorityIds,["distributor_account"]);
    assert.deepEqual(first.capabilityIds,["distributor-import"]);
    assert.ok(first.lessonIds.length <= 4);
    assert.ok(first.lessonIds.includes("DISTRIBUTOR_EXACT_KEY"));
    assert.ok(first.lessonIds.includes("EXACT_HEAD_PROOF_REUSE_RULE"));
    assert.ok(first.lessonIds.includes("LOCAL_EPHEMERAL_DB_TOOLCHAIN_RULE"));
    assert.ok(!first.lessonIds.includes("PIPELINE_ONLY"));
    assert.ok(!first.lessonIds.includes("REMOTE_RELEASE_EVIDENCE_RULE"));
    assert.doesNotMatch(first.packet,/completed secret description|historical:evidence|PIPELINE_ONLY|Controller-only release evidence/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("release lessons compile into controller context without entering worker context",()=>{
  const root=fixture();
  try {
    execFileSync("git",["-C",root,"init","-b","main"],{stdio:"ignore"});
    execFileSync("git",["-C",root,"config","user.email","context@test.invalid"]);
    execFileSync("git",["-C",root,"config","user.name","Context Test"]);
    execFileSync("git",["-C",root,"commit","--allow-empty","-m","fixture"],{stdio:"ignore"});
    const task:any={taskId:"REL",objective:"Harden remote release evidence",risk:"R2",domains:["release-governance"],repository:{worktreePath:root,branch:"main",expectedBaseRef:"HEAD",expectedBaseSha:null},allowedPaths:[".crm-engineering/**"],protectedDomains:[],productionDataMutation:false,schemaChange:false,phase:"IMPLEMENTATION",acceptance:[]};
    const controller=compileContext(root,task);
    const worker=compileWorkerContext(root,task);
    assert.match(controller,/REMOTE_RELEASE_EVIDENCE_RULE: Controller-only release evidence\./);
    assert.doesNotMatch(worker.packet,/REMOTE_RELEASE_EVIDENCE_RULE|Controller-only release evidence/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
