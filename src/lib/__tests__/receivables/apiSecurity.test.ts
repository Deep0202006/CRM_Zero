import fs from "fs";import path from "path";const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),"utf8");
describe("receivables server and recovery boundaries",()=>{
 test("readiness is server-only and defaults closed",()=>{const server=read("src/lib/receivables/server.ts");expect(server).toContain('process.env.RECEIVABLES_V1_READY === "true"');expect(server).not.toContain("NEXT_PUBLIC_RECEIVABLES")});
 test("server derives bearer identity and active capability",()=>{const server=read("src/lib/receivables/server.ts");expect(server).toContain("auth.getUser(token)");expect(server).toContain('from("users")');expect(server).toContain('capability_code==="admin"')});
 test("outbox is narrow, owner-keyed and replays exact commands",()=>{const client=read("src/lib/receivables/client.ts");expect(client).toContain("zerodata:receivables-outbox:${userId}");expect(client).toContain("item.command");expect(client).not.toContain("processSyncQueue");expect(client).not.toMatch(/\.from\(["']receivable/)});
 test("mutation routes ignore client actor and pass authenticated actor",()=>{const route=read("src/app/api/receivables/commands/route.ts");expect(route).toContain("p_actor_id:context.userId");expect(route).not.toContain("body.actor_id")});
});
