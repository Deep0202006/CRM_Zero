import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexAppServer } from "../src/codex-app-server.js";

class FakeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = 0;
  writes:any[] = [];
  constructor(handler?:(message:any, process:FakeProcess)=>void) {
    super();
    let buffer = "";
    this.stdin.on("data", chunk => {
      buffer += String(chunk);
      for (;;) {
        const at = buffer.indexOf("\n");
        if (at < 0) break;
        const line = buffer.slice(0,at); buffer = buffer.slice(at+1);
        const message = JSON.parse(line); this.writes.push(message); handler?.(message,this);
      }
    });
  }
  reply(value:any) { this.stdout.write(JSON.stringify(value)+"\n"); }
  kill() { this.killed++; return true; }
}

function server(handler?:(message:any, process:FakeProcess)=>void) {
  const process = new FakeProcess(handler);
  return { process, server:new CodexAppServer(()=>process as any) };
}
function respondTurn(message:any, process:FakeProcess, status="completed", final=true) {
  if (message.method !== "turn/start") return;
  process.reply({id:message.id,result:{turn:{id:"turn-1"}}});
  setImmediate(()=>{
    if (final) process.reply({method:"item/completed",params:{turnId:"turn-1",item:{type:"agentMessage",text:'{"taskId":"T"}'}}});
    process.reply({method:"turn/completed",params:{turn:{id:"turn-1",status}}});
  });
}

test("request resolver is registered before stdin write", async()=>{
  let pendingAtWrite = 0; let instance:CodexAppServer;
  const made = server((message,process)=>{ pendingAtWrite = instance.diagnostics().pendingRequests; process.reply({id:message.id,result:{ok:true}}); });
  instance = made.server;
  await instance.request("initialize",{});
  assert.equal(pendingAtWrite,1); instance.close();
});

test("concurrent request responses are matched by id regardless of response order", async()=>{
  const made=server();
  const first=made.server.request("first");
  const second=made.server.request("second");
  made.process.reply({id:2,result:"second-result"});
  made.process.reply({id:1,result:"first-result"});
  assert.deepEqual(await Promise.all([first,second]),["first-result","second-result"]);
  made.server.close();
});

test("stderr is continuously drained into bounded diagnostics", async()=>{
  const made=server(); made.process.stderr.write("x".repeat(70*1024)+"diagnostic-tail");
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(made.server.diagnostics().stderrTail,/diagnostic-tail/);
  assert.equal(made.server.diagnostics().stderrTail.length,64*1024); made.server.close();
});

test("completed turn resolves with final agent item", async()=>{
  const made=server((m,p)=>respondTurn(m,p));
  const result=await made.server.runTurn("t","C:\\repo","prompt");
  assert.equal(result.text,'{"taskId":"T"}'); made.server.close();
});

test("completed status is required for success", async()=>{
  const made=server((m,p)=>respondTurn(m,p,"failed"));
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/TURN_FAILED/); made.server.close();
});

test("failed turn rejects", async()=>{
  const made=server((m,p)=>respondTurn(m,p,"failed"));
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/status failed/); made.server.close();
});

test("interrupted turn rejects as cancellation", async()=>{
  const made=server((m,p)=>respondTurn(m,p,"interrupted"));
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/TURN_CANCELLED/); made.server.close();
});

test("subprocess exit rejects active request immediately", async()=>{
  const made=server(); const pending=made.server.request("initialize",{});
  made.process.emit("exit",9,null);
  await assert.rejects(pending,/CODEX_APP_SERVER_EXIT.*code=9/);
  assert.deepEqual({state:made.server.diagnostics().lifecycleState,code:made.server.diagnostics().exitCode,error:made.server.diagnostics().terminalErrorCode},{state:"failed",code:9,error:"CODEX_APP_SERVER_EXIT"});
  made.server.close();
});

test("request timeout rejects and removes resolver", async()=>{
  const old=process.env.CRM_CODEX_READ_TIMEOUT_MS; process.env.CRM_CODEX_READ_TIMEOUT_MS="15";
  const made=server(); await assert.rejects(made.server.request("initialize",{}),/REQUEST_TIMEOUT/);
  assert.equal(made.server.diagnostics().pendingRequests,0); made.server.close();
  if(old===undefined) delete process.env.CRM_CODEX_READ_TIMEOUT_MS; else process.env.CRM_CODEX_READ_TIMEOUT_MS=old;
});

test("stalled turn rejects after activity deadline", async()=>{
  const old=process.env.CRM_CODEX_STALL_TIMEOUT_MS; process.env.CRM_CODEX_STALL_TIMEOUT_MS="15";
  const made=server((m,p)=>{if(m.method==="turn/start")p.reply({id:m.id,result:{turn:{id:"turn-1"}}});});
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/STALL_TIMEOUT/); made.server.close();
  if(old===undefined) delete process.env.CRM_CODEX_STALL_TIMEOUT_MS; else process.env.CRM_CODEX_STALL_TIMEOUT_MS=old;
});

test("total turn timeout rejects despite activity", async()=>{
  const oldTurn=process.env.CRM_CODEX_TURN_TIMEOUT_MS, oldStall=process.env.CRM_CODEX_STALL_TIMEOUT_MS;
  process.env.CRM_CODEX_TURN_TIMEOUT_MS="20"; process.env.CRM_CODEX_STALL_TIMEOUT_MS="200";
  const made=server((m,p)=>{if(m.method==="turn/start")p.reply({id:m.id,result:{turn:{id:"turn-1"}}});});
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/TURN_TIMEOUT/); made.server.close();
  if(oldTurn===undefined)delete process.env.CRM_CODEX_TURN_TIMEOUT_MS;else process.env.CRM_CODEX_TURN_TIMEOUT_MS=oldTurn;
  if(oldStall===undefined)delete process.env.CRM_CODEX_STALL_TIMEOUT_MS;else process.env.CRM_CODEX_STALL_TIMEOUT_MS=oldStall;
});

test("malformed stdout fails active turn instead of hanging", async()=>{
  const made=server((m,p)=>{if(m.method==="turn/start"){p.reply({id:m.id,result:{turn:{id:"turn-1"}}});setImmediate(()=>p.stdout.write("not-json\n"));}});
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/MALFORMED_STDOUT/); made.server.close();
});

test("user input request fails closed with typed error", async()=>{
  const made=server((m,p)=>{if(m.method==="turn/start"){p.reply({id:m.id,result:{turn:{id:"turn-1"}}});setImmediate(()=>p.reply({id:99,method:"item/tool/requestUserInput",params:{}}));}});
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/CODEX_USER_INPUT_REQUIRED/); made.server.close();
});

test("approval requests use installed decline response shape", async()=>{
  const made=server(); made.process.reply({id:7,method:"item/commandExecution/requestApproval",params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(made.process.writes.at(-1),{id:7,result:{decision:"decline"}}); made.server.close();
});

test("legacy approvals use the installed denied response shape", async()=>{
  const made=server(); made.process.reply({id:"legacy-7",method:"execCommandApproval",params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(made.process.writes.at(-1),{id:"legacy-7",result:{decision:{denied:{rejection:"Approval policy is never"}}}}); made.server.close();
});

test("all bounded server request handlers return protocol-specific shapes", async()=>{
  const made=server();
  made.process.reply({id:"elicitation",method:"mcpServer/elicitation/request",params:{}});
  made.process.reply({id:"permissions",method:"item/permissions/requestApproval",params:{}});
  made.process.reply({id:"clock",method:"currentTime/read",params:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(made.process.writes[0],{id:"elicitation",result:{action:"decline",content:null,_meta:null}});
  assert.deepEqual(made.process.writes[1],{id:"permissions",result:{permissions:{},scope:"turn",strictAutoReview:true}});
  assert.equal(made.process.writes[2].id,"clock");
  assert.equal(typeof made.process.writes[2].result.currentTimeAt,"number");
  made.server.close();
});

test("turn notifications received before turn start response continuation are replayed in order", async()=>{
  const made=server((message,process)=>{
    if(message.method!=="turn/start")return;
    process.reply({id:message.id,result:{turn:{id:"turn-early"}}});
    process.reply({method:"item/completed",params:{turnId:"turn-early",item:{type:"agentMessage",text:"final early output"}}});
    process.reply({method:"turn/completed",params:{turn:{id:"turn-early",status:"completed"}}});
  });
  const result=await made.server.runTurn("t","C:\\repo","prompt");
  assert.equal(result.text,"final early output");
  made.server.close();
});

test("unknown server request fails active turn safely", async()=>{
  const made=server((m,p)=>{if(m.method==="turn/start"){p.reply({id:m.id,result:{turn:{id:"turn-1"}}});setImmediate(()=>p.reply({id:4,method:"future/request",params:{}}));}});
  await assert.rejects(made.server.runTurn("t","C:\\repo","prompt"),/UNSUPPORTED_SERVER_REQUEST/); made.server.close();
});

test("listeners and timers are cleaned after completion", async()=>{
  const made=server((m,p)=>respondTurn(m,p)); await made.server.runTurn("t","C:\\repo","prompt");
  assert.equal(made.server.diagnostics().listenerCount,0); made.server.close(); assert.equal(made.process.killed,1);
  assert.equal(made.server.diagnostics().lifecycleState,"closed");
});
