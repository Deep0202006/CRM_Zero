import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const classifier=path.resolve(process.cwd(),"scripts","classify-ci-scope.mjs");
const authorityChecker=path.resolve(process.cwd(),"scripts","check-pr-task-authority.mjs");
function classify(paths:string[]) {
  const result=spawnSync(process.execPath,[classifier,"--paths-json",JSON.stringify(paths)],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr); return result.stdout;
}

test("Graph-only path allowlist is exact and bounded",()=>{
  assert.equal(classify([".crm-engineering/tasks/T.json","tools/crm-graph/src/context.ts","docs/engineering-graph/START_HERE.md","AGENTS.md","CRM_CONTEXT.md"]),"graph_only");
});
test("workflow, product, schema, unknown, and empty changes fail safe to full",()=>{
  for (const paths of [[".github/workflows/harness.yml"],["src/app/page.tsx"],["supabase/migrations/047.sql"],["README.md"],[]]) assert.equal(classify(paths),"full");
});

test("workflow uses dynamic task discovery and never hard-codes a historical task",()=>{
  const workflow=fs.readFileSync(path.resolve(process.cwd(),"..","..",".github","workflows","harness.yml"),"utf8");
  assert.match(workflow,/classify:/);
  assert.match(workflow,/needs\.classify\.outputs\.graph_only/);
  assert.match(workflow,/\.crm-engineering\/tasks\/\*\.json/);
  assert.match(workflow,/No changed Graph tasks/);
  assert.doesNotMatch(workflow,/crm:status -- --task CRM-P0-045/);
  assert.match(workflow,/check-pr-task-authority\.mjs --base "\$BASE_SHA" --head "\$HEAD_SHA"/);
});

test("PR authority requires one changed task with the exact base and complete diff coverage",async()=>{
  const {checkPrTaskAuthority}=await import(pathToFileURL(authorityChecker).href);
  const baseSha="a".repeat(40);
  const task=(overrides:any={})=>({
    taskId:"T", repository:{expectedBaseSha:baseSha},
    allowedPaths:[".crm-engineering/**","src/**","supabase/migrations/**"], ...overrides
  });
  const input={baseSha,changedPaths:[".crm-engineering/tasks/T.json","src/app/page.tsx","supabase/migrations/048_x.sql"]};
  assert.deepEqual(checkPrTaskAuthority({...input,changedTasks:[{path:".crm-engineering/tasks/T.json",task:task()}]}),{required:true,taskId:"T"});
  assert.throws(()=>checkPrTaskAuthority({...input,changedTasks:[]}),/GRAPH_TASK_REQUIRED/);
  assert.throws(()=>checkPrTaskAuthority({...input,changedTasks:[{path:".crm-engineering/tasks/T.json",task:task({repository:{expectedBaseSha:"b".repeat(40)}})}]}),/BASE_MISMATCH/);
  assert.throws(()=>checkPrTaskAuthority({...input,changedTasks:[{path:".crm-engineering/tasks/T.json",task:task({allowedPaths:[".crm-engineering\/\*\*","src\/\*\*"]})}]}),/DIFF_NOT_COVERED.*048_x\.sql/);
  assert.throws(()=>checkPrTaskAuthority({...input,changedTasks:[{path:".crm-engineering/tasks/OTHER.json",task:task()}]}),/TASK_ID_FILE_MISMATCH/);
});

test("Graph-only pull requests do not require a product/schema task",async()=>{
  const {checkPrTaskAuthority}=await import(pathToFileURL(authorityChecker).href);
  assert.deepEqual(checkPrTaskAuthority({baseSha:"a",changedPaths:["tools/crm-graph/src/context.ts"],changedTasks:[]}),{required:false,taskId:null});
});

test("cheap authority and affected checks gate every expensive suite without removing full verification",()=>{
  const workflow=fs.readFileSync(path.resolve(process.cwd(),"..","..",".github","workflows","harness.yml"),"utf8").replace(/\r\n/g,"\n");
  const preflight=workflow.indexOf("  preflight:");
  const graph=workflow.indexOf("Typecheck CRM Engineering Graph",preflight);
  const task=workflow.indexOf("Require coherent Graph task authority",preflight);
  const typecheck=workflow.indexOf("Typecheck product with exact-base failure ablation",preflight);
  const affected=workflow.indexOf("Run affected product tests before expensive suites",preflight);
  assert.ok(preflight>=0&&graph>preflight&&task>graph&&typecheck>task&&affected>typecheck);
  assert.match(workflow,/receivables-postgres:\n    needs: \[classify, preflight\]/);
  assert.match(workflow,/verify:\n    needs: \[classify, preflight\]/);
  assert.match(workflow,/e2e:\n    needs: \[classify, preflight, verify\]/);
  for(const retained of ["Apply migration and run Receivables database integration","Test product with exact-base failure ablation","Lint product with exact-base failure ablation","Build product with exact-base failure ablation","Run Receivables browser authorization and intake flows"])assert.match(workflow,new RegExp(retained));
});
