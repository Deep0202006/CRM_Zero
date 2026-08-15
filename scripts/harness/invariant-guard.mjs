import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  const protectedBusinessRead = normalizedFile.includes("/payments/") || normalizedFile.includes("/api/distributors/") || normalizedFile.includes("/components/distributors/");
  if (protectedBusinessRead && /\.select\(\s*["'`]\*["'`]\s*\)/i.test(text)) hits.push("protected hot path SELECT star");
  if (protectedBusinessRead && /\bsetInterval\s*\(/i.test(text)) hits.push("protected business screen polling");
  if (clientCode && /\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,300}?\.update\s*\(/i.test(text)) hits.push("direct browser Pipeline mutation bypasses authority");
  if (!normalizedFile.includes("/__tests__/") && (normalizedFile.includes("/pipeline/") || normalizedFile.includes("/onboarding/")) && /from\s+["'][^"']*(?:task|calllogs|fieldvisits|receivables)[^"']*["']/i.test(text)) hits.push("Pipeline imports cross-domain write helper");
  if (normalizedFile.endsWith("src/app/api/call-logs/confirm/route.ts") && /\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(text)) hits.push("Call confirmation creates Lead");
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
function sourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (executable.has(extname(entry.name))) found.push(full);
  }
  return found;
}
for (const absolute of sourceFiles(resolve(root, "src"))) {
  const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
  if (relative.includes("/__tests__/")) continue;
  const source = withoutComments(readFileSync(absolute, "utf8"));
  requireInvariant(!/\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(source), `LEAD_CREATION_SINGLE_ENTRY_GUARD: ${relative} writes Leads directly`);
  requireInvariant(!/transactionalMutation\(\s*["'`]leads["'`]\s*,\s*["'`]INSERT["'`]/i.test(source), `LEAD_CREATION_SINGLE_ENTRY_GUARD: ${relative} queues a generic Lead insert`);
  if (relative !== "src/app/api/pipeline/create/route.ts") requireInvariant(!/rpc\(\s*["'`](?:pipeline_create_lead_v1|create_lead)["'`]/i.test(source), `LEAD_CREATION_SINGLE_ENTRY_GUARD: ${relative} invokes Lead creation authority`);
  if (relative !== "src/app/onboarding/page.tsx") requireInvariant(!/from\s+["'][^"']*pipeline\/createLeadService["']/i.test(source), `LEAD_CREATION_SINGLE_ENTRY_GUARD: ${relative} imports Pipeline creation`);
}
const pipelineStages = readFileSync(resolve(root, "src/lib/pipelineStages.ts"), "utf8");
const retailerStages = pipelineStages.match(/RETAILER_PIPELINE_STAGES\s*=([\s\S]*?);/)?.[1] ?? "";
const distributorStages = pipelineStages.match(/DISTRIBUTOR_PIPELINE_STAGES\s*=([\s\S]*?);/)?.[1] ?? "";
requireInvariant(retailerStages.includes('stage !== "Payment"'), "Retailer stage map must exclude Payment");
requireInvariant(distributorStages.includes('stage !== "Converted"') && pipelineStages.includes('to: "Payment"') && pipelineStages.includes('segment: "Distributor"'), "Distributor stage map must retain Payment");
const pipelineServer = readFileSync(resolve(root, "src/app/api/pipeline/server.ts"), "utf8");
requireInvariant(pipelineServer.includes('.range(start, start + pageSize - 1)'), "Pipeline list must remain server bounded");
requireInvariant(!/\.select\(\s*["'`]\*["'`]\s*\)/.test(pipelineServer), "Pipeline hot read cannot SELECT star");
const pipelineRepository = readFileSync(resolve(root, "src/lib/pipeline/repository.ts"), "utf8");
requireInvariant(!/setInterval\s*\(/.test(pipelineRepository), "Pipeline cannot poll");
const databaseSource = readFileSync(resolve(root, "src/lib/db.ts"), "utf8");
const fullPullTables = databaseSource.match(/const tables = \[([\s\S]*?)\];/)?.[1] ?? "";
requireInvariant(!/["'`]leads["'`]/.test(fullPullTables), "Pipeline cannot be hydrated through the unbounded full-workspace pull");
requireInvariant(databaseSource.includes('item.table_name === PIPELINE_CREATE_QUEUE_TABLE || item.table_name === "leads"'), "current and previous Lead create queues must converge on the canonical server command");
const transitionRoute = readFileSync(resolve(root, "src/app/api/pipeline/transition/route.ts"), "utf8");
requireInvariant(transitionRoute.includes("command.actor_id !== context.userId") && transitionRoute.includes("p_actor_id: context.userId"), "Pipeline mutation API must derive and assert actor identity");
const callConfirm = readFileSync(resolve(root, "src/app/api/call-logs/confirm/route.ts"), "utf8");
requireInvariant(!/\.from\(\s*["'`]leads["'`]\s*\)[\s\S]{0,400}?\.(?:insert|upsert|update)\s*\(/i.test(callConfirm), "Call confirmation cannot mutate Leads");
for (const migration of changedPaths().filter((file) => file.startsWith("supabase/migrations/") && file.endsWith(".sql") && existsSync(resolve(root, file)))) {
  const sql = readFileSync(resolve(root, migration), "utf8").replace(/--.*$/gm, "");
  requireInvariant(!/\bdelete\s+from\s+public\.leads\b|\btruncate\b/i.test(sql), `${migration} cannot DELETE Leads or TRUNCATE`);
}
requireInvariant(existsSync(resolve(root, "src/lib/__tests__/pipeline/pipelineHardeningMigration.test.ts")), "Pipeline cross-domain mutation assertions are required");
requireInvariant(existsSync(resolve(root, "docs/contracts/RESOURCE_BUDGET.md")), "hot-query changes require the Resource Budget contract");
const ownerSqlFiles = [
  ...readdirSync(root).filter((file) => /^owner-.*\.sql$/i.test(file)),
  ...requested.filter((file) => /^owner-.*\.sql$/i.test(file.replaceAll("\\", "/").split("/").at(-1) ?? "")),
];
for (const ownerSqlFile of ownerSqlFiles) {
  const ownerSql = readFileSync(resolve(root, ownerSqlFile), "utf8");
  requireInvariant(!/^\s*\\/m.test(ownerSql), `${ownerSqlFile} must be pure PostgreSQL for Supabase SQL Editor (OWNER_SQL_IS_PURE_POSTGRESQL)`);
}
const normalizeSqlArtifact = (sql) => sql.replace(/\r\n/g, "\n").trimEnd();
requireInvariant(
  normalizeSqlArtifact(readFileSync(resolve(root, "owner-041.sql"), "utf8")) === normalizeSqlArtifact(readFileSync(resolve(root, "supabase/migrations/041_distributor_mapped_status.sql"), "utf8")),
  "owner-041.sql must remain semantically identical to migration 041"
);
requireInvariant(
  normalizeSqlArtifact(readFileSync(resolve(root, "owner-042.sql"), "utf8")) === normalizeSqlArtifact(readFileSync(resolve(root, "supabase/migrations/042_payment_collection_renewals.sql"), "utf8")),
  "owner-042.sql must remain semantically identical to migration 042"
);
requireInvariant(
  normalizeSqlArtifact(readFileSync(resolve(root, "owner-043.sql"), "utf8")) === normalizeSqlArtifact(readFileSync(resolve(root, "supabase/migrations/043_pipeline_creation_authority.sql"), "utf8")),
  "owner-043.sql must remain semantically identical to migration 043"
);
const attendanceAuthority = readFileSync(resolve(root, "src/lib/attendance/authority.ts"), "utf8");
const adminAttendance = readFileSync(resolve(root, "src/app/api/admin/attendance/route.ts"), "utf8");
const teamKpiAggregation = readFileSync(resolve(root, "src/lib/teamKpi/aggregate.ts"), "utf8");
const attendanceQueue = readFileSync(resolve(root, "src/lib/db.ts"), "utf8");
const authContext = readFileSync(resolve(root, "src/context/AuthContext.tsx"), "utf8");
const attendancePage = readFileSync(resolve(root, "src/app/attendance/page.tsx"), "utf8");
requireInvariant(attendanceAuthority.includes("resolveAttendanceDay") && !/selfie_(?:url|storage_path|purged_at)[\s\S]{0,80}?present\s*:/.test(attendanceAuthority), "Attendance presence must be independent from evidence state");
requireInvariant(!adminAttendance.includes("selfie_url") && !/\.select\(\s*["'`]\*["'`]\s*\)/.test(adminAttendance), "Attendance list authority cannot hydrate evidence payloads or SELECT star");
requireInvariant(teamKpiAggregation.includes("resolveAttendanceDay"), "Team Attendance and Team KPI must share the canonical attendance resolver");
requireInvariant(attendanceQueue.includes("if (!shouldAttemptSyncQueueItem(item)) continue") && attendanceQueue.includes("isActiveSyncQueueItem(item) && retryIsDue"), "passive Attendance recovery evidence cannot be selected for automatic retry");
requireInvariant(attendanceQueue.includes("withSyncQueueBrowserLock(() => confirmQueuedAttendanceInternal(attendanceId))") && attendanceQueue.includes("activeSyncQueueRun = withSyncQueueBrowserLock"), "Attendance direct and background confirmation must serialize across tabs");
requireInvariant(authContext.indexOf('authority.mode !== "office_auto"') < authContext.indexOf("saveAttendanceWithEvidence(newRecord, null)"), "office auto-attendance requires server-authoritative mode");
requireInvariant(attendancePage.includes("setAuthoritativeMode(result.mode)") && attendancePage.includes('authoritativeMode === "field_selfie"'), "online Attendance evidence mode must come from server authority");
const criticalRoutes = ["src/app/admin/payments/page.tsx", "src/app/admin/payments/renewals/page.tsx", "src/app/admin/payments/distributors/page.tsx", "src/app/payments/page.tsx", "src/app/payments/renewals/page.tsx", "src/app/payments/distributors/page.tsx"];
for (const route of criticalRoutes) requireInvariant(existsSync(resolve(root, route)), `critical route missing: ${route}`);
const navigation = readFileSync(resolve(root, "src/components/DashboardLayout.tsx"), "utf8");
for (const href of ["/admin/payments", "/payments", "/admin/payments/renewals", "/payments/renewals", "/admin/payments/distributors", "/payments/distributors"]) requireInvariant(navigation.includes(href), `critical navigation target missing: ${href}`);
const distributorMetricsRoute = readFileSync(resolve(root, "src/app/api/distributors/metrics/route.ts"), "utf8");
const receivablesAdminRoute = readFileSync(resolve(root, "src/app/api/receivables/admin/route.ts"), "utf8");
requireInvariant((distributorMetricsRoute.match(/distributor_status_metrics_v1/g) ?? []).length === 1, "Distributor cards must use one metrics RPC");
requireInvariant(distributorMetricsRoute.includes("listEligibleOperationalEmployees") && receivablesAdminRoute.includes("listEligibleOperationalEmployees"), "Payment and Distributor employee selectors must share canonical authority");
requireInvariant(!distributorMetricsRoute.includes("distributorReady") && !readFileSync(resolve(root, "src/app/api/distributors/route.ts"), "utf8").includes("distributorReady"), "Distributor empty state cannot depend on a hardcoded readiness flag");
const authorityRegistry = JSON.parse(readFileSync(resolve(root, "docs/os/AUTHORITY_REGISTRY.json"), "utf8"));
requireInvariant(authorityRegistry.facts?.renewal === "public.distributor_accounts.renewal_date", "Renewal authority registry must remain canonical");
const analyticsDirectory = resolve(root, "src/components/analytics");
const analyticsSource = sourceFiles(analyticsDirectory).map((file) => readFileSync(file, "utf8")).join("\n");
const analyticsModel = readFileSync(resolve(root, "src/lib/analytics/viewModels.ts"), "utf8");
requireInvariant(!/fetch\s*\(|supabase|\.from\s*\(|\.rpc\s*\(|setInterval\s*\(|\.channel\s*\(|localStorage|indexedDB/i.test(`${analyticsSource}\n${analyticsModel}`), "Visual intelligence components must remain prop-only presentation");
requireInvariant(!/from ["'](?:@?nivo|chart\.js|echarts|@tremor\/react|@?heroui|react-bits)/i.test(analyticsSource), "Recharts must remain the only Visual Intelligence chart engine");
requireInvariant(analyticsSource.includes('data-chart-height="stable"'), "Visual Intelligence charts require deterministic parent heights");
requireInvariant(!/(?:title|label|heading)[^\n]*(?:performance score|employee score|ranking|grade)/i.test(analyticsSource), "Visual Intelligence cannot invent employee scores or rankings");
const teamKpiPage = readFileSync(resolve(root, "src/app/manager/kpi/page.tsx"), "utf8");
const adminVisitsPage = readFileSync(resolve(root, "src/app/admin/visits/page.tsx"), "utf8");
requireInvariant((teamKpiPage.match(/fetch\("\/api\/team-kpi"/g) ?? []).length === 1 && !/setInterval\s*\(/.test(teamKpiPage), "Team KPI Visual Intelligence must keep one initial request and zero polling");
requireInvariant((adminVisitsPage.match(/fetch\(`\/api\/admin\/visits\?\$\{params\}`/g) ?? []).length === 1 && !/setInterval\s*\(/.test(adminVisitsPage), "Visits Visual Intelligence must keep one bounded initial request and zero polling");
requireInvariant(analyticsModel.includes("outcomes.reduce") || analyticsSource.includes("outcomes.reduce"), "Visit donut must enforce represented-population parity");
const renewalMigration = readFileSync(resolve(root, "supabase/migrations/042_payment_collection_renewals.sql"), "utf8").replace(/--.*$/gm, "");
requireInvariant(!/\b(?:create|alter)\s+table\b|\bcreate\s+(?:unique\s+)?index\b/i.test(renewalMigration), "Renewals cannot create duplicate storage or a speculative index");
requireInvariant(!/\b(?:insert\s+into|update|delete\s+from|truncate)\b/i.test(renewalMigration), "Renewal read migration cannot mutate business data");
requireInvariant(renewalMigration.includes("greatest(1,least(coalesce(p_page_size,50),50))"), "Renewal list must remain bounded to 50 rows");
const renewalRoute = readFileSync(resolve(root, "src/app/api/distributors/renewals/route.ts"), "utf8");
requireInvariant((renewalRoute.match(/distributor_renewal_metrics_v1/g) ?? []).length === 1, "Renewal cards must use one metrics RPC");
requireInvariant((renewalRoute.match(/distributor_renewals_list_v1/g) ?? []).length === 1, "Renewal table must use one bounded list RPC");
requireInvariant(renewalRoute.includes("distributorReadError") && !/catch[\s\S]{0,160}(?:rows\s*:\s*\[\]|return\s+\[\])/i.test(renewalRoute), "Renewal API errors cannot silently become empty data");
const renewalPage = readFileSync(resolve(root, "src/components/distributors/PaymentRenewalsPage.tsx"), "utf8");
requireInvariant(renewalPage.includes("view=metrics") && renewalPage.includes("view=list") && renewalPage.includes("pageSize=50"), "Renewal screen must declare its two-request 50-row budget");
requireInvariant(!/setInterval|\.select\(\s*["'`]\*["'`]\s*\)/i.test(renewalPage), "Renewal screen cannot poll or SELECT star");
requireInvariant(renewalPage.includes("Unable to load renewals") && renewalPage.includes("No renewal dates set yet"), "Renewal empty and server-error states must remain distinct");
const distributorCommandRoute = readFileSync(resolve(root, "src/app/api/distributors/commands/route.ts"), "utf8");
requireInvariant((distributorCommandRoute.match(/distributor_status_command_v1/g) ?? []).length === 1 && !/\.rpc\(\s*["'`]receivable/i.test(distributorCommandRoute), "Distributor mutations cannot call financial authority");
if (failed) process.exit(1);
console.log(`Invariant guard passed (${files.length} executable changed files scanned differentially).`);
