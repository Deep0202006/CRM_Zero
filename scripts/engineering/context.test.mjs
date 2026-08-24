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
for (const [name, args, domain] of cases) { const pack = parsed(...args); if (!pack.domains.includes(domain) || pack.estimatedTokens > pack.budget) throw new Error(`${name} context failed`); }
const includes = (pack, id, key = "id") => pack[key].some((item) => (typeof item === "string" ? item : item.id) === id);
const assert = (path, capability, lessons) => { const pack = parsed("--path", path); if (!includes(pack, capability, "capabilities") || lessons.some((id) => !includes(pack, id, "lessons"))) throw new Error(`knowledge retrieval failed: ${path}`); };
assert("src/app/api/call-logs/confirm/route.ts", "canonical-call-confirmation", ["WRITE_READ_CLOSURE", "OFFLINE_COMPATIBILITY"]);
assert("src/app/mappings/page.tsx", "mapping-standalone-persistence", ["ONE_FACT_ONE_AUTHORITY"]);
assert("src/components/visits/CurrentErpBaselineEditor.tsx", "current-business-erp-intelligence", ["ERP_AUTHORITIES", "NO_FABRICATED_BACKFILL", "TRANSACTION_STAGING"]);
assert("src/app/api/distributors/master-import/route.ts", "unified-distributor-master-import", ["ATOMIC_BATCH", "SPREADSHEET_COMMIT", "RESOLVED_PLAN_REVALIDATION"]);
assert("src/app/api/receivables/commands/route.ts", "receivables-command-boundary", ["MONEY_TRUTH", "POSTGRES_WIRE_NORMALIZATION"]);
assert("src/app/api/pipeline/create/route.ts", "pipeline-create-lead-boundary", ["SERVER_AUTHORIZATION"]);
assert("src/app/api/chat/messages/route.ts", "team-chat-boundary", ["SERVER_AUTHORIZATION"]);
assert("src/app/api/task-upload/route.ts", "task-allocation-batch-rpc", ["ATOMIC_BATCH"]);
const uuidTask = parsed("--path", "src/app/api/distributors/route.ts", "--task", "Distributor ERP filter Invalid UUID");
if (!includes(uuidTask, "POSTGRES_UUID_NOT_RFC_UUID", "lessons") || !uuidTask.lessonSelection.POSTGRES_UUID_NOT_RFC_UUID?.includes("task-trigger")) throw new Error("ERP UUID task-trigger retrieval failed");
const presentationTask = parsed("--path", "src/app/api/distributors/route.ts", "--task", "adjust Distributor ERP footprint presentation spacing");
if (includes(presentationTask, "POSTGRES_UUID_NOT_RFC_UUID", "lessons")) throw new Error("unrelated ERP UI task retrieved UUID lesson");
const constrained = parsed("--path", "src/app/api/distributors/route.ts", "--budget", "500");
if (!constrained.omittedLessons.length || constrained.estimatedTokens > constrained.budget) throw new Error("budget trimming did not preserve a usable pack");
const platform = parsed("--mode", "platform");
if (platform.mode !== "platform" || platform.risk !== "R3" || !platform.domainIndex.length || platform.lessons) throw new Error("platform discovery map failed");
for (const effect of ["DATABASE","AUTHORIZATION"]) if (parsed("--domain","erp","--effect",effect).risk !== "R3") throw new Error(`${effect} did not escalate`);
if (parsed("--domain","shared-ui","--effect","UI").risk === "R3") throw new Error("UI-only context escalated to R3");
const cross = parsed("--path","src/components/visits/CurrentErpBaselineEditor.tsx", "--task", "invalid UUID"); if (!cross.domains.includes("erp") || !cross.domains.includes("field-visits") || cross.scope !== "cross-domain" || cross.lessons.length < 9 || cross.estimatedTokens > cross.budget) throw new Error("deterministic multi-domain context failed");
for (const code of ["UNMAPPED_PATH","AUTHORITY_UNRESOLVED"]) { try { run(code === "UNMAPPED_PATH" ? "--path" : "--domain", code === "UNMAPPED_PATH" ? "src/nope.ts" : "shared-ui", "--effect", "DATABASE"); throw new Error(`${code} accepted`); } catch (error) { if (!String(error.stderr ?? error).includes(code)) throw error; } }
console.log(`Context resolver tests passed (${cases.length} real paths).`);
