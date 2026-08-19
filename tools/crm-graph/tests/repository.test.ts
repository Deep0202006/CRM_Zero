import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { changedPaths, inspectRepo, worktreeFingerprint } from "../src/git.js";
import { bindTaskRepository } from "../src/binding.js";

function git(cwd:string,...args:string[]){return execFileSync("git",["-C",cwd,...args],{encoding:"utf8"}).trim();}
function repo(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"crm-graph-repo-")); git(root,"init","-b","main");
  git(root,"config","user.email","graph@test.invalid");git(root,"config","user.name","Graph Test");
  fs.writeFileSync(path.join(root,"tracked.txt"),"one\n");git(root,"add","tracked.txt");git(root,"commit","-m","base");
  git(root,"remote","add","origin",root);git(root,"fetch","origin","main:refs/remotes/origin/main"); return root;
}

test("clean worktree fingerprint is deterministic",()=>{const root=repo();assert.equal(worktreeFingerprint(root).hash,worktreeFingerprint(root).hash);});
test("tracked dirty content mutation changes fingerprint",()=>{const root=repo();fs.writeFileSync(path.join(root,"tracked.txt"),"two\n");const a=worktreeFingerprint(root).hash;fs.writeFileSync(path.join(root,"tracked.txt"),"three\n");assert.notEqual(a,worktreeFingerprint(root).hash);});
test("staged tracked content mutation changes fingerprint with the same status",()=>{const root=repo();fs.writeFileSync(path.join(root,"tracked.txt"),"two\n");git(root,"add","tracked.txt");const statusA=git(root,"status","--porcelain=v1");const a=worktreeFingerprint(root).hash;fs.writeFileSync(path.join(root,"tracked.txt"),"three\n");git(root,"add","tracked.txt");assert.equal(git(root,"status","--porcelain=v1"),statusA);assert.notEqual(a,worktreeFingerprint(root).hash);});
test("untracked content mutation changes fingerprint with same filename",()=>{const root=repo();fs.writeFileSync(path.join(root,"new.txt"),"one");const a=worktreeFingerprint(root).hash;fs.writeFileSync(path.join(root,"new.txt"),"two");assert.notEqual(a,worktreeFingerprint(root).hash);});
test("untracked binary content mutation changes fingerprint",()=>{const root=repo();fs.writeFileSync(path.join(root,"binary.dat"),Buffer.from([0,1,2,3]));const a=worktreeFingerprint(root).hash;fs.writeFileSync(path.join(root,"binary.dat"),Buffer.from([0,1,2,4]));assert.notEqual(a,worktreeFingerprint(root).hash);});
test("untracked path ordering is stable",()=>{const root=repo();fs.writeFileSync(path.join(root,"z.txt"),"z");fs.writeFileSync(path.join(root,"a.txt"),"a");assert.deepEqual(worktreeFingerprint(root).untracked,["a.txt","z.txt"]);});
test("changed paths preserve the complete porcelain path",()=>{const root=repo();fs.writeFileSync(path.join(root,"CRM_CONTEXT.md"),"x");assert.deepEqual(changedPaths(root),["CRM_CONTEXT.md"]);});

test("task bind uses the canonical preflight fingerprint",()=>{
  const root=repo();fs.mkdirSync(path.join(root,".worktrees"));const wt=path.join(root,".worktrees","feature");git(root,"worktree","add","-b","feature",wt,"origin/main");
  fs.writeFileSync(path.join(wt,"dirty.txt"),"content");
  const task:any={repository:{canonicalRoot:root,worktreePath:null,branch:"feature",expectedBaseRef:"origin/main",expectedBaseSha:null,observedHeadSha:null,dirtyBaselineHash:null},phase:"REPOSITORY_RECOVERY"};
  bindTaskRepository(task,wt);assert.equal(task.repository.dirtyBaselineHash,inspectRepo(wt).dirtyHash);assert.equal(task.phase,"DISCOVERY");
});

test("task bind resolves relative worktree paths from canonical root",()=>{
  const root=repo();fs.mkdirSync(path.join(root,".worktrees"));const wt=path.join(root,".worktrees","relative");git(root,"worktree","add","-b","relative",wt,"origin/main");
  const task:any={taskId:"T",repository:{canonicalRoot:root,worktreePath:null,branch:"relative",expectedBaseRef:"origin/main",expectedBaseSha:null,observedHeadSha:null,dirtyBaselineHash:null},phase:"REPOSITORY_RECOVERY"};
  bindTaskRepository(task,path.join(".worktrees","relative"));assert.equal(task.repository.worktreePath,fs.realpathSync.native(wt));
});

test("repeat bind is idempotent and cannot rebaseline later dirty content",()=>{
  const root=repo();fs.mkdirSync(path.join(root,".worktrees"));const wt=path.join(root,".worktrees","stable");git(root,"worktree","add","-b","stable",wt,"origin/main");
  const task:any={taskId:"T",repository:{canonicalRoot:root,worktreePath:null,branch:"stable",expectedBaseRef:"origin/main",expectedBaseSha:null,observedHeadSha:null,dirtyBaselineHash:null},phase:"REPOSITORY_RECOVERY"};
  const first=bindTaskRepository(task,wt);const bound=structuredClone(task.repository);fs.writeFileSync(path.join(wt,"later.txt"),"owner change");const second=bindTaskRepository(task,wt);
  assert.equal(first.unchanged,false);assert.equal(second.unchanged,true);assert.deepEqual(task.repository,bound);assert.notEqual(inspectRepo(wt).dirtyHash,task.repository.dirtyBaselineHash);
});

test("bound task rejects switching to another worktree",()=>{
  const root=repo();fs.mkdirSync(path.join(root,".worktrees"));const one=path.join(root,".worktrees","one"),two=path.join(root,".worktrees","two");git(root,"worktree","add","-b","one",one,"origin/main");git(root,"worktree","add","-b","two",two,"origin/main");
  const task:any={taskId:"T",repository:{canonicalRoot:root,worktreePath:null,branch:"one",expectedBaseRef:"origin/main",expectedBaseSha:null,observedHeadSha:null,dirtyBaselineHash:null},phase:"REPOSITORY_RECOVERY"};bindTaskRepository(task,one);assert.throws(()=>bindTaskRepository(task,two),/REPOSITORY_ALREADY_BOUND/);
});

test("bind rejects a different repository placed under canonical worktrees",()=>{
  const root=repo();const alien=path.join(root,".worktrees","alien");fs.mkdirSync(alien,{recursive:true});git(alien,"init","-b","alien");git(alien,"config","user.email","graph@test.invalid");git(alien,"config","user.name","Graph Test");fs.writeFileSync(path.join(alien,"alien.txt"),"alien");git(alien,"add",".");git(alien,"commit","-m","alien");
  const task:any={taskId:"T",repository:{canonicalRoot:root,worktreePath:null,branch:"alien",expectedBaseRef:"HEAD",expectedBaseSha:null,observedHeadSha:null,dirtyBaselineHash:null},phase:"REPOSITORY_RECOVERY"};assert.throws(()=>bindTaskRepository(task,alien),/REPOSITORY_IDENTITY_MISMATCH/);
});

test("crm:bind CLI persists the deterministic repository binding",()=>{
  const root=repo();fs.mkdirSync(path.join(root,".crm-engineering","tasks"),{recursive:true});fs.writeFileSync(path.join(root,".crm-engineering","manifest.json"),"{}\n");
  const task:any={schemaVersion:2,graphSchemaVersion:1,flowVersion:"1.1.0",taskId:"T",objective:"bind",risk:"R0",domains:["engineering-graph"],repository:{canonicalRoot:root,worktreePath:null,branch:"cli-bind",expectedBaseRef:"origin/main",expectedBaseSha:null,observedHeadSha:null,dirtyBaselineHash:null},phase:"REPOSITORY_RECOVERY",allowedPaths:[".crm-engineering/**"],protectedDomains:[],productionDataMutation:false,schemaChange:false,humanGate:null,acceptance:[],blocker:null};
  const taskPath=path.join(root,".crm-engineering","tasks","T.json");fs.writeFileSync(taskPath,JSON.stringify(task,null,2)+"\n");git(root,"add",".");git(root,"commit","-m","graph metadata");git(root,"fetch","origin","main:refs/remotes/origin/main","--force");
  fs.mkdirSync(path.join(root,".worktrees"));const wt=path.join(root,".worktrees","cli-bind");git(root,"worktree","add","-b","cli-bind",wt,"origin/main");
  const cli=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../src/cli.js");const output=execFileSync(process.execPath,[cli,"bind","--root",root,"--task","T","--worktree",wt],{encoding:"utf8",cwd:root});
  const reported=JSON.parse(output);const saved=JSON.parse(fs.readFileSync(taskPath,"utf8"));assert.equal(reported.taskId,"T");assert.equal(reported.unchanged,false);assert.equal(saved.repository.worktreePath,fs.realpathSync.native(wt));assert.equal(saved.repository.expectedBaseSha,git(wt,"rev-parse","origin/main"));assert.equal(saved.phase,"DISCOVERY");
});

test("task bind rejects sibling worktree outside canonical .worktrees",()=>{
  const root=repo();const sibling=fs.mkdtempSync(path.join(os.tmpdir(),"crm-graph-sibling-"));
  const task:any={repository:{canonicalRoot:root,worktreePath:null,branch:null,expectedBaseRef:"origin/main"},phase:"REPOSITORY_RECOVERY"};
  assert.throws(()=>bindTaskRepository(task,sibling),/WORKTREE_LOCATION/);
});
