import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const run = (...args) => execFileSync("node", ["scripts/engineering/context.mjs", ...args], { cwd: root, encoding: "utf8" });
const parsed = (...args) => JSON.parse(run(...args));
const cases = [
 ["ERP", ["--path","src/components/visits/CurrentErpBaselineEditor.tsx"], "erp"],
 ["Master import", ["--path","src/app/api/distributors/master-import/route.ts"], "imports"],
 ["Receivables", ["--path","src/app/api/receivables/commands/route.ts"], "receivables"],
 ["Pipeline", ["--path","src/app/api/pipeline/create/route.ts"], "pipeline"],
 ["Calls", ["--path","src/app/api/call-logs/confirm/route.ts"], "calls"],
 ["Visits", ["--path","src/app/api/field-visits/confirm/route.ts"], "field-visits"],
 ["Mappings", ["--path","src/app/mappings/page.tsx"], "mappings"],
 ["Support", ["--path","src/app/support/page.tsx"], "queries"],
 ["Followups", ["--path","src/app/api/my-day/payment-followups/route.ts"], "followups"],
 ["Chat", ["--path","src/app/api/chat/messages/route.ts"], "team-chat"],
 ["KPI", ["--path","src/app/api/team-kpi/route.ts"], "team-kpi"],
 ["Tasks", ["--path","src/app/api/task-upload/route.ts"], "task-allocation"]
];
for (const [name, args, domain] of cases) { const pack = parsed(...args); if (!pack.domains.includes(domain) || pack.estimatedTokens > 1500) throw new Error(`${name} context failed`); }
for (const effect of ["DATABASE","AUTHORIZATION"]) if (parsed("--domain","erp","--effect",effect).risk !== "R3") throw new Error(`${effect} did not escalate`);
if (parsed("--domain","shared-ui","--effect","UI").risk === "R3") throw new Error("UI-only context escalated to R3");
const cross = parsed("--path","src/components/visits/CurrentErpBaselineEditor.tsx"); if (!cross.domains.includes("erp") || !cross.domains.includes("field-visits")) throw new Error("deterministic multi-domain context failed");
if (cross.lessons.length > 8) throw new Error("lesson cap failed");
for (const code of ["UNMAPPED_PATH","AUTHORITY_UNRESOLVED"]) { try { run(code === "UNMAPPED_PATH" ? "--path" : "--domain", code === "UNMAPPED_PATH" ? "src/nope.ts" : "shared-ui", "--effect", "DATABASE"); throw new Error(`${code} accepted`); } catch (error) { if (!String(error.stderr ?? error).includes(code)) throw error; } }
console.log(`Context resolver tests passed (${cases.length} real paths).`);
