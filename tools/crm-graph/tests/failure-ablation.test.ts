import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
const ablationModule=pathToFileURL(path.resolve(process.cwd(),"scripts/run-failure-ablation.mjs")).href;

function git(root:string,...args:string[]){return execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();}
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"crm-ablation-test-"));git(root,"init","-b","main");git(root,"config","user.email","ablation@test.invalid");git(root,"config","user.name","Ablation Test");fs.writeFileSync(path.join(root,"state.txt"),"base");git(root,"add",".");git(root,"commit","-m","base");const base=git(root,"rev-parse","HEAD");fs.writeFileSync(path.join(root,"state.txt"),"head");git(root,"add",".");git(root,"commit","-m","head");return{root,base};}

test("failing HEAD suite passing at exact base is HEAD_REGRESSION",async()=>{const {runFailureAblation}=await import(ablationModule);const f=fixture();const command=[process.execPath,"-e","process.exit(require('fs').readFileSync('state.txt','utf8')==='base'?0:1)"];assert.deepEqual(runFailureAblation({root:f.root,baseSha:f.base,suite:"unit",prepare:[],command}),{classification:"HEAD_REGRESSION",exitCode:1});});
test("suite failing at HEAD and exact base is BASELINE_FAILURE",async()=>{const {runFailureAblation}=await import(ablationModule);const f=fixture();const command=[process.execPath,"-e","process.exit(1)"];assert.deepEqual(runFailureAblation({root:f.root,baseSha:f.base,suite:"lint",prepare:[],command}),{classification:"BASELINE_FAILURE",exitCode:1});});
test("passing HEAD suite does not create an ablation classification",async()=>{const {runFailureAblation}=await import(ablationModule);const f=fixture();assert.deepEqual(runFailureAblation({root:f.root,baseSha:f.base,suite:"typecheck",prepare:[],command:[process.execPath,"-e","process.exit(0)"]}),{classification:"PASS",exitCode:0});});
test("workflow ablates each focused product suite against the pull-request base",()=>{const workflow=fs.readFileSync(path.resolve(process.cwd(),"..","..",".github/workflows/harness.yml"),"utf8");for(const suite of ["typecheck","unit","lint","build"])assert.match(workflow,new RegExp(`run-failure-ablation\\.mjs[^\\n]+pull_request\\.base\\.sha[^\\n]+--suite ${suite}`));});
