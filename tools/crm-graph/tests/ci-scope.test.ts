import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const classifier=path.resolve(process.cwd(),"scripts","classify-ci-scope.mjs");
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
});
