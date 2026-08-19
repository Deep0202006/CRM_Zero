import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type Pending = { resolve:(value:any)=>void; reject:(error:Error)=>void; timer:NodeJS.Timeout };
type ProcessLike = ChildProcessWithoutNullStreams;
type SpawnProcess = () => ProcessLike;
type RequestId = string|number;
type LifecycleState = "running"|"failed"|"closed";
const STDERR_LIMIT = 64 * 1024;

export class CodexAppServerError extends Error {
  constructor(public readonly code:string, message:string, public readonly stderrTail:string = "") {
    super(`${code}: ${message}${stderrTail ? `\nRecent App Server stderr:\n${stderrTail}` : ""}`);
    this.name = "CodexAppServerError";
  }
}

function positiveTimeout(name:string, fallback:number) {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultSpawn():ProcessLike {
  const command = process.platform === "win32" ? "cmd.exe" : "codex";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "codex.cmd app-server --stdio"] : ["app-server", "--stdio"];
  return spawn(command, args, { stdio:["pipe","pipe","pipe"], windowsHide:true });
}

export class CodexAppServer {
  private readonly proc:ProcessLike;
  private readonly lines:readline.Interface;
  private id = 0;
  private pending = new Map<RequestId, Pending>();
  private listeners = new Set<(message:any)=>void>();
  private stderrTail = "";
  private terminalError:CodexAppServerError|null = null;
  private closed = false;
  private lifecycleState:LifecycleState = "running";
  private exitCode:number|null = null;
  private exitSignal:NodeJS.Signals|null = null;
  private messagesReceived = 0;
  private lastActivityAt = Date.now();

  constructor(spawnProcess:SpawnProcess = defaultSpawn) {
    this.proc = spawnProcess();
    this.proc.stderr.on("data", chunk => { this.stderrTail = (this.stderrTail + String(chunk)).slice(-STDERR_LIMIT); });
    this.proc.on("error", error => this.failProcess("CODEX_APP_SERVER_EXIT", error.message));
    this.proc.on("exit", (code, signal) => this.recordExit("exited", code, signal));
    this.proc.on("close", (code, signal) => this.recordExit("closed", code, signal));
    this.lines = readline.createInterface({ input:this.proc.stdout });
    this.lines.on("line", line => this.handleLine(line));
  }

  private diagnostic(code:string, message:string) { return new CodexAppServerError(code, message, this.stderrTail); }

  private recordExit(event:string, code:number|null, signal:NodeJS.Signals|null) {
    this.exitCode = code;
    this.exitSignal = signal;
    this.failProcess("CODEX_APP_SERVER_EXIT", `process ${event} code=${code ?? "null"} signal=${signal ?? "null"}`);
  }

  private failProcess(code:string, message:string) {
    if (this.closed && this.pending.size === 0) return;
    this.lifecycleState = "failed";
    this.terminalError ??= this.diagnostic(code, message);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(this.terminalError);
      this.pending.delete(id);
    }
    for (const listener of this.listeners) listener({ method:"client/processFailed", params:{ error:this.terminalError } });
  }

  private handleLine(line:string) {
    if (!line.trim()) return;
    this.messagesReceived++;
    this.lastActivityAt = Date.now();
    let message:any;
    try { message = JSON.parse(line); }
    catch {
      for (const listener of this.listeners) listener({ method:"client/malformedStdout", params:{ line } });
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && ("result" in message || "error" in message) && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(this.diagnostic("CODEX_APP_SERVER_REQUEST_FAILED", JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      this.handleServerRequest(message);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  private handleServerRequest(message:any) {
    const method = message.method as string;
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      this.sendRaw({ id:message.id, result:{ decision:"decline" } });
      return;
    }
    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      this.sendRaw({ id:message.id, result:{ decision:{ denied:{ rejection:"Approval policy is never" } } } });
      return;
    }
    if (method === "mcpServer/elicitation/request") {
      this.sendRaw({ id:message.id, result:{ action:"decline", content:null, _meta:null } });
      return;
    }
    if (method === "item/permissions/requestApproval") {
      this.sendRaw({ id:message.id, result:{ permissions:{}, scope:"turn", strictAutoReview:true } });
      return;
    }
    if (method === "item/tool/call") {
      this.sendRaw({ id:message.id, result:{ contentItems:[{ type:"inputText", text:`Unsupported dynamic tool: ${message.params?.tool ?? "unknown"}` }], success:false } });
      return;
    }
    if (method === "currentTime/read") {
      this.sendRaw({ id:message.id, result:{ currentTimeAt:Math.floor(Date.now()/1000) } });
      return;
    }
    const code = method === "item/tool/requestUserInput" ? "CODEX_USER_INPUT_REQUIRED" : "CODEX_UNSUPPORTED_SERVER_REQUEST";
    const error = this.diagnostic(code, `App Server requested ${method}`);
    this.sendRaw({ id:message.id, error:{ code:-32601, message:error.message } });
    for (const listener of this.listeners) listener({ method:"client/serverRequestFailed", params:{ error, method } });
  }

  private sendRaw(value:any) {
    if (this.terminalError) throw this.terminalError;
    if (this.closed) throw this.diagnostic("CODEX_APP_SERVER_CLOSED", "client closed");
    this.proc.stdin.write(JSON.stringify(value) + "\n");
  }

  request(method:string, params:any = {}) {
    if (this.terminalError) return Promise.reject(this.terminalError);
    const id = ++this.id;
    const timeout = positiveTimeout("CRM_CODEX_READ_TIMEOUT_MS", 30_000);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(this.diagnostic("CODEX_APP_SERVER_REQUEST_TIMEOUT", `${method} exceeded ${timeout}ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.sendRaw({ method, id, params }); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method:string, params:any = {}) { this.sendRaw({ method, params }); }
  onMessage(listener:(message:any)=>void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async initialize() {
    await this.request("initialize", { clientInfo:{ name:"zerodata_crm_engineering_graph", title:"ZeroData CRM Engineering Graph", version:"1.1.0" } });
    this.notify("initialized", {});
  }
  async startThread(cwd:string) {
    const result = await this.request("thread/start", { cwd, approvalPolicy:"never", sandbox:"workspace-write" });
    return result.thread.id as string;
  }
  async resumeThread(threadId:string, cwd:string) {
    const result = await this.request("thread/resume", { threadId, cwd, approvalPolicy:"never", sandbox:"workspace-write" });
    return result.thread.id as string;
  }

  async runTurn(threadId:string, cwd:string, prompt:string) {
    let streamedText = "";
    let finalText = "";
    let activeTurnId:string|null = null;
    const turnTimeout = positiveTimeout("CRM_CODEX_TURN_TIMEOUT_MS", 20 * 60_000);
    const stallTimeout = positiveTimeout("CRM_CODEX_STALL_TIMEOUT_MS", 5 * 60_000);
    return await new Promise<{text:string;turn:any}>((resolve, reject) => {
      const earlyMessages:any[] = [];
      let totalTimer:NodeJS.Timeout;
      let stallTimer:NodeJS.Timeout;
      let settled = false;
      const cleanup = () => { clearTimeout(totalTimer); clearTimeout(stallTimer); off(); };
      const fail = (error:Error) => { if (!settled) { settled = true; cleanup(); reject(error); } };
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => fail(this.diagnostic("CODEX_APP_SERVER_STALL_TIMEOUT", `no activity for ${stallTimeout}ms`)), stallTimeout);
      };
      const handleTurnMessage = (message:any) => {
        armStall();
        if (message.method === "client/processFailed" || message.method === "client/serverRequestFailed") return fail(message.params.error);
        if (message.method === "client/malformedStdout") return fail(this.diagnostic("CODEX_APP_SERVER_MALFORMED_STDOUT", message.params.line));
        if (message.method === "item/agentMessage/delta" && (!activeTurnId || message.params?.turnId === activeTurnId)) streamedText += message.params?.delta ?? "";
        if (message.method === "item/completed" && message.params?.item?.type === "agentMessage" && (!activeTurnId || message.params?.turnId === activeTurnId)) finalText = message.params.item.text ?? finalText;
        if (message.method === "turn/completed" && message.params?.turn?.id === activeTurnId) {
          const status = message.params.turn.status;
          if (status !== "completed") return fail(this.diagnostic(status === "interrupted" ? "CODEX_APP_SERVER_TURN_CANCELLED" : "CODEX_APP_SERVER_TURN_FAILED", `turn ${activeTurnId} ended with status ${status}`));
          const text = finalText || streamedText;
          if (!text.trim()) return fail(this.diagnostic("CODEX_APP_SERVER_EMPTY_RESULT", "completed turn contained no agent output"));
          settled = true;
          cleanup();
          resolve({ text, turn:message.params.turn });
        }
      };
      const off = this.onMessage(message => {
        if (!activeTurnId && !message.method?.startsWith("client/")) {
          earlyMessages.push(message);
          return;
        }
        handleTurnMessage(message);
      });
      totalTimer = setTimeout(() => fail(this.diagnostic("CODEX_APP_SERVER_TURN_TIMEOUT", `turn exceeded ${turnTimeout}ms`)), turnTimeout);
      stallTimer = setTimeout(() => fail(this.diagnostic("CODEX_APP_SERVER_STALL_TIMEOUT", `no activity for ${stallTimeout}ms`)), stallTimeout);
      this.request("turn/start", {
        threadId, input:[{ type:"text", text:prompt }], cwd,
        sandboxPolicy:{ type:"workspaceWrite", writableRoots:[cwd], networkAccess:false }, approvalPolicy:"never"
      }).then(start => {
        activeTurnId = start.turn.id;
        armStall();
        for (const message of earlyMessages) handleTurnMessage(message);
      }).catch(fail);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lifecycleState = "closed";
    this.lines.close();
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(this.diagnostic("CODEX_APP_SERVER_CLOSED", "client closed"));
      this.pending.delete(id);
    }
    this.proc.kill();
    this.listeners.clear();
  }
  diagnostics() {
    return {
      lifecycleState:this.lifecycleState,
      pid:this.proc.pid ?? null,
      exitCode:this.exitCode,
      exitSignal:this.exitSignal,
      stderrTail:this.stderrTail,
      pendingRequests:this.pending.size,
      listenerCount:this.listeners.size,
      messagesReceived:this.messagesReceived,
      lastActivityAt:this.lastActivityAt,
      terminalErrorCode:this.terminalError?.code ?? null
    };
  }
}
