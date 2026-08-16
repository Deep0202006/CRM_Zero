import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { baselineRef, changedPaths, git, root } from "./common.mjs";

const executable = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const files = (requested.length ? requested : changedPaths()).filter((file) =>
  executable.has(extname(file)) &&
  !file.replaceAll("\\", "/").includes("scripts/harness/__tests__/") &&
  existsSync(resolve(root, file))
);

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function findings(source, file) {
  const text = withoutComments(source);
  const compact = text.replace(/\s+/g, " ");
  const rules = [
    ["call_logs deletion", /(?:delete\s+from\s+["'`]?call_logs\b|\.from\(\s*["'`]call_logs["'`]\s*\)[\s\S]{0,180}?\.delete\s*\()/gi],
    ["field_visits deletion", /(?:delete\s+from\s+["'`]?field_visits\b|\.from\(\s*["'`]field_visits["'`]\s*\)[\s\S]{0,180}?\.delete\s*\()/gi],
    ["chat_messages deletion", /(?:delete\s+from\s+["'`]?chat_messages\b|\.from\(\s*["'`]chat_messages["'`]\s*\)[\s\S]{0,180}?\.delete\s*\()/gi],
    ["chat_messages mutation", /\.from\(\s*["'`]chat_messages["'`]\s*\)[\s\S]{0,180}?\.update\s*\(/gi],
    ["call_logs.clear", /\b(?:db\.)?call_logs\s*\.\s*clear\s*\(/gi],
    ["field_visits.clear", /\b(?:db\.)?field_visits\s*\.\s*clear\s*\(/gi],
    ["field_visit_media.clear", /\b(?:db\.)?field_visit_media\s*\.\s*clear\s*\(/gi],
    ["localStorage.clear", /\blocalStorage\s*\.\s*clear\s*\(/gi],
    ["browser database deletion", /\b(?:indexedDB\s*\.\s*)?deleteDatabase\s*\(/gi],
    ["financial table deletion", /(?:delete\s+from\s+["'`]?(?:receivables|receivable_payments)\b|\.from\(\s*["'`](?:receivables|receivable_payments)["'`]\s*\)[\s\S]{0,180}?\.delete\s*\()/gi],
  ];
  const hits = [];
  for (const [label, regex] of rules) for (const match of compact.matchAll(regex)) if (match) hits.push(label);

  const clientCode = /(^|\n)\s*["']use client["']/.test(text) || (!file.startsWith("src/app/api/") && (file.endsWith(".tsx") || file.includes("/components/")));
  if (clientCode && /(?:SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|service_role)/i.test(text)) hits.push("service-role secret reference in client code");
  if (clientCode && /\bVAPID_PRIVATE_KEY\b/.test(text)) hits.push("VAPID private key reference in client code");
  if (clientCode && /\.from\(\s*["'`](?:call_logs|field_visits)["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(text)) hits.push("direct browser critical write bypasses confirmation API");
  if (clientCode && /\.from\(\s*["'`](?:receivables|receivable_payments)["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert|update|delete)\s*\(/i.test(text)) hits.push("direct browser financial write bypasses Receivables command API");

  const normalizedFile = file.replaceAll("\\", "/").toLowerCase();
  if (clientCode && /\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,300}?\.update\s*\(/i.test(text)) hits.push("direct browser Pipeline mutation bypasses authority");
  if (!normalizedFile.includes("/__tests__/") && (normalizedFile.includes("/pipeline/") || normalizedFile.includes("/onboarding/")) && /from\s+["'][^"']*(?:task|calllogs|fieldvisits|receivables)[^"']*["']/i.test(text)) hits.push("Pipeline imports cross-domain write helper");
  if (normalizedFile.endsWith("src/app/api/call-logs/confirm/route.ts") && /\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(text)) hits.push("Call confirmation creates Lead");
  if (normalizedFile.includes("/mappings/") && /(?:transactionalMutation\(\s*["'`]leads["'`]|\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert|update)\s*\()/i.test(text)) hits.push("Mapping creates or mutates Lead");
  if ((normalizedFile.includes("/pipeline/") || normalizedFile.includes("/onboarding/")) && /\.select\(\s*["'`]\*["'`]\s*\)/i.test(text)) hits.push("Pipeline hot path SELECT star");
  const testLike = /(?:^|[\/._-])(?:__tests__|test|tests|qa|fixtures?|smoke)(?:[\/._-]|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizedFile);
  const productionAccess = /(?:SUPABASE_SERVICE_ROLE_KEY|PRODUCTION_SUPABASE|\.env\.production)/i.test(text);
  const businessTableMutation = /\.from\(\s*["'`](?:users|leads|call_logs|field_visits|tasks|attendance|client_queries|queries|mappings|mapping_requests|chat|chats|messages)["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert|update|delete)\s*\(/i.test(text);
  if (testLike && productionAccess && businessTableMutation) hits.push("production test writes business data");
  return hits;
}

let failed = false;
for (const file of files) {
  const current = readFileSync(resolve(root, file), "utf8");
  let baseline = "";
  if (!requested.length) {
    try { baseline = git(["show", `${baselineRef()}:${file}`]); } catch { baseline = ""; }
  }
  const before = findings(baseline, file);
  const after = findings(current, file);
  const counts = new Map();
  for (const item of before) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of after) {
    const remaining = counts.get(item) ?? 0;
    if (remaining) counts.set(item, remaining - 1);
    else { console.error(`${file}: prohibited new pattern: ${item}`); failed = true; }
  }
}
function requireInvariant(ok, message) { if (!ok) { console.error(`semantic invariant: ${message}`); failed = true; } }
const pipelineStages = readFileSync(resolve(root, "src/lib/pipelineStages.ts"), "utf8");
const retailerStages = pipelineStages.match(/RETAILER_PIPELINE_STAGES\s*=([\s\S]*?);/)?.[1] ?? "";
const distributorStages = pipelineStages.match(/DISTRIBUTOR_PIPELINE_STAGES\s*=([\s\S]*?);/)?.[1] ?? "";
requireInvariant(retailerStages.includes('stage !== "Payment"'), "Retailer stage map must exclude Payment");
requireInvariant(distributorStages.includes('stage !== "Converted"') && pipelineStages.includes('to: "Payment"') && pipelineStages.includes('segment: "Distributor"'), "Distributor stage map must retain Payment");
const pipelineServer = readFileSync(resolve(root, "src/app/api/pipeline/server.ts"), "utf8");
requireInvariant(pipelineServer.includes('.range(start, start + pageSize - 1)'), "Pipeline list must remain server bounded");
requireInvariant(!/\.select\(\s*["'`]\*["'`]\s*\)/.test(pipelineServer), "Pipeline hot read cannot SELECT star");
const transitionRoute = readFileSync(resolve(root, "src/app/api/pipeline/transition/route.ts"), "utf8");
requireInvariant(transitionRoute.includes("command.actor_id !== context.userId") && transitionRoute.includes("p_actor_id: context.userId"), "Pipeline mutation API must derive and assert actor identity");
const callConfirm = readFileSync(resolve(root, "src/app/api/call-logs/confirm/route.ts"), "utf8");
requireInvariant(!/\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,400}?\.(?:insert|upsert|update)\s*\(/i.test(callConfirm), "Call confirmation cannot mutate Leads");
for (const migration of changedPaths().filter((file) => file.startsWith("supabase/migrations/") && file.endsWith(".sql") && existsSync(resolve(root, file)))) {
  const sql = readFileSync(resolve(root, migration), "utf8").replace(/--.*$/gm, "");
  requireInvariant(!/\bdelete\s+from\s+public\.leads\b|\btruncate\b/i.test(sql), `${migration} cannot DELETE Leads or TRUNCATE`);
}
const requestedSql = requested.filter((file) => /(?:^|[\\/])owner-\d+(?:-precheck|-postcheck)?\.sql$/i.test(file) && existsSync(resolve(root, file)));
const ownerSqlFiles = requestedSql.length ? requestedSql : changedPaths().filter((file) => /^owner-\d+(?:-precheck|-postcheck)?\.sql$/i.test(file) && existsSync(resolve(root, file)));
for (const file of ownerSqlFiles) {
  const sql = readFileSync(resolve(root, file), "utf8");
  requireInvariant(!/^\s*\\|\b(?:\\copy|\\set|\\if|\\echo)\b|(?<!:):[A-Za-z]\w*/m.test(sql), `${file} must be pure PostgreSQL for Supabase SQL Editor`);
}
const mappingPage = readFileSync(resolve(root, "src/app/mappings/page.tsx"), "utf8");
const callPage = readFileSync(resolve(root, "src/app/call-logs/page.tsx"), "utf8");
const supportPage = readFileSync(resolve(root, "src/app/support/page.tsx"), "utf8");
for (const [name, source] of [["Mapping", mappingPage], ["Call Logs", callPage], ["Client Query", supportPage]]) {
  requireInvariant(source.includes("buildCanonicalClientOptions"), `${name} must reuse the canonical client option provider`);
}
requireInvariant(!/transactionalMutation\(\s*["'`]leads["'`]|db\.leads|resolveLeadId|Mapping Form/i.test(mappingPage), "Mapping must have zero Lead creation authority or Pipeline dependency");
requireInvariant(mappingPage.includes("distributor_name_unregistered") && mappingPage.includes("retailer_name_unregistered"), "Mapping must persist faithful free-text display values");
const retailerVisitForm = readFileSync(resolve(root, "src/app/visits/new/retailer/page.tsx"), "utf8");
const distributorVisitForm = readFileSync(resolve(root, "src/app/visits/new/distributor/page.tsx"), "utf8");
requireInvariant(retailerVisitForm.includes('className="field-label">Area ') && distributorVisitForm.includes('className="field-label">Address '), "Visit UI labels must be Retailer Area and Distributor Address");
for (const [name, source] of [["Retailer", retailerVisitForm], ["Distributor", distributorVisitForm]]) {
  requireInvariant(source.includes("pincode: pincode.trim()") && source.indexOf('htmlFor="visit-address"') < source.indexOf('htmlFor="visit-pincode"') && source.indexOf('htmlFor="visit-pincode"') < source.lastIndexOf('"Save Visit"'), `${name} Visit must close Address/Area → Pincode → Save order`);
  requireInvariant(!/fetch\([^)]*pincode/i.test(source), `${name} Visit pincode cannot add a request`);
}
const visitMine = readFileSync(resolve(root, "src/app/api/field-visits/mine/route.ts"), "utf8");
const adminVisits = readFileSync(resolve(root, "src/app/api/admin/visits/route.ts"), "utf8");
const visitExport = readFileSync(resolve(root, "src/app/api/admin/export-visits/route.ts"), "utf8");
requireInvariant(visitMine.includes("address,pincode") && adminVisits.includes("address,pincode") && visitExport.includes("Pincode: visit.pincode"), "Visit pincode must close personal/admin/export reads");
const pincodeMigration = readFileSync(resolve(root, "supabase/migrations/041_field_visit_pincode.sql"), "utf8").replace(/--.*$/gm, "");
requireInvariant(/ADD COLUMN IF NOT EXISTS pincode text NULL/i.test(pincodeMigration) && !/UPDATE\s+public\.field_visits|ALTER COLUMN pincode SET NOT NULL/i.test(pincodeMigration), "Visit pincode migration must preserve historical NULL rows without backfill");
requireInvariant(existsSync(resolve(root, "src/lib/__tests__/pipeline/pipelineHardeningMigration.test.ts")), "Pipeline cross-domain mutation assertions are required");
requireInvariant(existsSync(resolve(root, "docs/contracts/RESOURCE_BUDGET.md")), "hot-query changes require the Resource Budget contract");
const attendanceAuthority = readFileSync(resolve(root, "src/lib/attendance/authority.ts"), "utf8");
const adminAttendance = readFileSync(resolve(root, "src/app/api/admin/attendance/route.ts"), "utf8");
const teamKpiAggregation = readFileSync(resolve(root, "src/lib/teamKpi/aggregate.ts"), "utf8");
requireInvariant(attendanceAuthority.includes("resolveAttendanceDay") && !/selfie_(?:url|storage_path|purged_at)[\s\S]{0,80}?present\s*:/.test(attendanceAuthority), "Attendance presence must be independent from evidence state");
requireInvariant(!adminAttendance.includes("selfie_url") && !/\.select\(\s*["'`]\*["'`]\s*\)/.test(adminAttendance), "Attendance list authority cannot hydrate evidence payloads or SELECT star");
requireInvariant(teamKpiAggregation.includes("resolveAttendanceDay"), "Team Attendance and Team KPI must share the canonical attendance resolver");
if (failed) process.exit(1);
console.log(`Invariant guard passed (${files.length} executable changed files scanned differentially).`);
