import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

type Pending = { resolve:(v:any)=>void; reject:(e:any)=>void };

export class CodexAppServer {
  private proc: ChildProcessWithoutNullStreams;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners: ((m:any)=>void)[] = [];

  constructor() {
    // Global npm installs expose codex as codex.cmd on Windows; child_process
    // does not resolve the PowerShell shim that interactive shells use.
    const command = process.platform === "win32" ? "cmd.exe" : "codex";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", "codex.cmd app-server --stdio"]
      : ["app-server", "--stdio"];
    this.proc = spawn(command, args, {
      stdio:["pipe","pipe","pipe"],
      windowsHide:true
    });

    this.proc.on("error", error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });

    const rl = readline.createInterface({ input:this.proc.stdout });
    rl.on("line", line => {
      if (!line.trim()) return;
      let msg:any;
      try { msg = JSON.parse(line); } catch { return; }

      if (typeof msg.id === "number" && ("result" in msg || "error" in msg)) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
        return;
      }

      // Fail closed on server-initiated approval/user-input requests.
      if (typeof msg.id === "number" && typeof msg.method === "string") {
        this.sendRaw({ id:msg.id, result:{ decision:"decline" } });
        return;
      }

      for (const fn of this.listeners) fn(msg);
    });
  }

  private sendRaw(obj:any) {
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  request(method:string, params:any = {}) {
    const id = ++this.id;
    this.sendRaw({ method, id, params });
    return new Promise<any>((resolve,reject) => this.pending.set(id,{resolve,reject}));
  }

  notify(method:string, params:any = {}) {
    this.sendRaw({ method, params });
  }

  onMessage(fn:(m:any)=>void) { this.listeners.push(fn); }

  async initialize() {
    await this.request("initialize", {
      clientInfo: {
        name: "zerodata_crm_engineering_graph",
        title: "ZeroData CRM Engineering Graph",
        version: "1.0.0"
      }
    });
    this.notify("initialized", {});
  }

  async startThread(cwd:string) {
    const result = await this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      // The installed protocol's thread-level enum is kebab-case.
      sandbox: "workspace-write"
    });
    return result.thread.id as string;
  }

  async runTurn(threadId:string, cwd:string, prompt:string) {
    let text = "";
    let completed:any = null;

    const listener = (msg:any) => {
      if (msg.method === "item/agentMessage/delta") {
        text += msg.params?.delta ?? "";
      }
      if (msg.method === "turn/completed" && msg.params?.turn?.id) {
        completed = msg.params.turn;
      }
    };
    this.onMessage(listener);

    const start = await this.request("turn/start", {
      threadId,
      input:[{ type:"text", text:prompt }],
      cwd,
      // The installed protocol's per-turn policy is the structured camel-case form.
      sandboxPolicy:{ type:"workspaceWrite", writableRoots:[cwd], networkAccess:false },
      approvalPolicy:"never"
    });
    const turnId = start.turn.id;

    const deadline = Date.now() + 60 * 60 * 1000;
    while (!completed || completed.id !== turnId) {
      if (Date.now() > deadline) throw new Error("Codex turn timed out.");
      await new Promise(r => setTimeout(r, 100));
    }
    return { text, turn:completed };
  }

  close() {
    this.proc.kill();
  }
}
