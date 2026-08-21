import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(command,cwd) {
  return spawnSync(command[0],command.slice(1),{cwd,stdio:"inherit",shell:false,env:process.env}).status ?? 1;
}

function git(cwd,args,stdio="pipe") {
  return spawnSync("git",["-C",cwd,...args],{encoding:"utf8",stdio,shell:false});
}

function output(classification,suite,baseSha) {
  const line=`FAILURE_ABLATION classification=${classification} suite=${suite} exact_base=${baseSha}`;
  process.stdout.write(`${line}\n`);
  if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`classification=${classification}\n`);
}

export function runFailureAblation({root,baseSha,suite,prepare,command}) {
  const headStatus=run(command,root);
  if(headStatus===0) return {classification:"PASS",exitCode:0};

  const resolved=git(root,["rev-parse","--verify",`${baseSha}^{commit}`]);
  if(resolved.status!==0) throw new Error(`ABLATION_BASE_UNAVAILABLE: ${baseSha}`);
  const exactBase=resolved.stdout.trim();
  const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),"crm-failure-ablation-"));
  let added=false;
  try {
    const add=git(root,["worktree","add","--detach",tempRoot,exactBase],"inherit");
    if(add.status!==0) throw new Error("ABLATION_WORKTREE_CREATE_FAILED");
    added=true;
    const observed=git(tempRoot,["rev-parse","HEAD"]);
    if(observed.status!==0 || observed.stdout.trim()!==exactBase) throw new Error("ABLATION_EXACT_BASE_MISMATCH");
    if(prepare.length && run(prepare,tempRoot)!==0) throw new Error("ABLATION_BASE_PREPARE_FAILED");
    const baseStatus=run(command,tempRoot);
    const classification=baseStatus===0 ? "HEAD_REGRESSION" : "BASELINE_FAILURE";
    output(classification,suite,exactBase);
    return {classification,exitCode:headStatus};
  } finally {
    if(added) git(root,["worktree","remove","--force",tempRoot],"ignore");
    if(fs.existsSync(tempRoot)) fs.rmSync(tempRoot,{recursive:true,force:true});
  }
}

function arg(name) { const index=process.argv.indexOf(name); return index>=0 ? process.argv[index+1] : undefined; }
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const baseSha=arg("--base"),suite=arg("--suite"),commandJson=arg("--command-json");
    if(!baseSha||!suite||!commandJson) throw new Error("Usage: run-failure-ablation.mjs --base <sha> --suite <name> --command-json <array> [--prepare-json <array>]");
    const command=JSON.parse(commandJson),prepare=JSON.parse(arg("--prepare-json")??"[]");
    if(!Array.isArray(command)||command.length===0||!command.every(x=>typeof x==="string")||!Array.isArray(prepare)||!prepare.every(x=>typeof x==="string")) throw new Error("Ablation commands must be non-empty string arrays");
    const result=runFailureAblation({root:process.cwd(),baseSha,suite,prepare,command});
    process.exitCode=result.exitCode;
  }catch(error){process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=2;}
}
