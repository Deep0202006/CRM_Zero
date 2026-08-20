import { CodexWorkerSession } from "../../../tools/crm-graph/src/worker.js";
import type { CodexAppServer } from "../../../tools/crm-graph/src/codex-app-server.js";
import type { TaskFile } from "../../../tools/crm-graph/src/types.js";

async function main() {
  const prompts:string[]=[];
  const fake={
  initialize:async()=>{},
  startThread:async()=>"thread",
  resumeThread:async(id:string)=>id,
  runTurn:async(_id:string,_cwd:string,prompt:string)=>{
    prompts.push(prompt);
    return {text:'{"taskId":"MEASURE","acceptanceUpdates":[{"id":"A","status":"PASS","evidenceIds":["measure"]}],"changedPaths":[],"externalBlocker":null,"summary":"ok"}',turn:{}};
  },
  close:()=>{}
  };
  const task={
  taskId:"MEASURE",
  repository:{worktreePath:process.cwd()},
  acceptance:[{id:"A",description:"Measure repeated prompt",stage:"IMPLEMENTATION",status:"PENDING",required:true,evidenceIds:[]}]
  } as unknown as TaskFile;
  const session=new CodexWorkerSession(()=>fake as unknown as CodexAppServer);
  const context=`WORKER_CONTEXT\n${"canonical context ".repeat(400)}`;
  await session.run(task,context,"IMPLEMENT",task.acceptance[0]);
  await session.run(task,context,"IMPLEMENT",task.acceptance[0]);
  const initialPromptBytes=Buffer.byteLength(prompts[0]);
  const repeatedPromptBytes=Buffer.byteLength(prompts[1]);
  process.stdout.write(JSON.stringify({
    initialPromptBytes,
    repeatedPromptBytes,
    reductionPercent:Number(((1-repeatedPromptBytes/initialPromptBytes)*100).toFixed(2)),
    fullContextRepeated:prompts[1].includes("WORKER_CONTEXT"),
    focusedAcceptanceFirst:prompts[0].includes("acceptance A: Measure repeated prompt"),
    focusedAcceptanceRepeated:prompts[1].includes("acceptance A: Measure repeated prompt")
  },null,2));
  session.close();
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
