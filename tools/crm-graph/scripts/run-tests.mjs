import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const outputRoot = fs.mkdtempSync(path.join(packageRoot,"node_modules",".crm-graph-tests-"));
const tsc = path.join(packageRoot,"node_modules","typescript","bin","tsc");

function run(command,args) {
  const result = spawnSync(command,args,{cwd:packageRoot,stdio:"inherit",shell:false});
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const compileStatus = run(process.execPath,[tsc,"-p","tsconfig.json","--outDir",outputRoot]);
  if (compileStatus !== 0) process.exitCode = compileStatus;
  else {
    const tests = fs.readdirSync(path.join(outputRoot,"tests"))
      .filter(name => name.endsWith(".test.js"))
      .sort()
      .map(name => path.join(outputRoot,"tests",name));
    if (tests.length === 0) throw new Error("No compiled controller tests found.");
    process.exitCode = run(process.execPath,["--test",...tests]);
  }
} finally {
  fs.rmSync(outputRoot,{recursive:true,force:true});
}
