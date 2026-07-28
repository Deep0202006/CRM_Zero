import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const failures = [];
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
).filter((name) => /\.(?:ts|tsx|js|mjs|sql)$/.test(name));
const clientText = walk("src").filter((name) =>
  !name.includes(`${path.sep}app${path.sep}api${path.sep}`) &&
  !name.includes(`${path.sep}__tests__${path.sep}`)
).map(read).join("\n");
const dbText = read("src/lib/db.ts");
const kpiApi = read("src/app/api/team-kpi/route.ts");
const visitApi = read("src/app/api/admin/visits/route.ts");
const migration = read("supabase/migrations/030_server_authoritative_data_platform.sql");
const requirePattern = (condition, message) => { if (!condition) failures.push(message); };
requirePattern(!clientText.includes("SUPABASE_SERVICE_ROLE_KEY"), "service-role key referenced in browser code");
requirePattern(/get_team_kpi_daily_v5/.test(kpiApi) && !/\.from\(["'](?:call_logs|client_queries|mapping_requests|tasks|allocated_targets)/.test(kpiApi), "Team KPI API is not projection-RPC only");
requirePattern(!/activity[_ -]?deck/i.test(kpiApi), "Team KPI depends on Activity Deck");
requirePattern(!/get_team_kpi_v[1-4]\b/.test(kpiApi), "legacy KPI RPC referenced");
requirePattern(!/idempotency_key\s*:\s*(?:crypto\.randomUUID|uuidv4)/.test(dbText), "random queue idempotency key detected");
requirePattern(!/COALESCE\s*\(\s*(?:NEW\.)?(?:status|problem_status|outcome)\s*,\s*''\s*\)/i.test(migration), "enum-unsafe COALESCE detected");
requirePattern(/unsynchronized\.total\s*>\s*0[\s\S]*signedOut:\s*false/.test(read("src/context/AuthContext.tsx")), "logout does not guard unsynchronized work");
requirePattern(!/createSignedUrl/.test(visitApi), "visit list eagerly creates signed URLs");
const repairedWorkflowText = [
  "src/app/manager/kpi/page.tsx", "src/app/admin/visits/page.tsx",
  "src/app/call-logs/page.tsx", "src/app/support/page.tsx",
  "src/app/mappings/page.tsx", "src/app/my-day/page.tsx",
  "src/app/visits/new/retailer/page.tsx", "src/app/visits/new/distributor/page.tsx",
].map(read).join("\n");
requirePattern(!/(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(repairedWorkflowText), "native dialog in repaired workflow");
requirePattern((dbText.match(/window\.addEventListener\("online"/g) ?? []).length === 1, "duplicate online queue processor trigger");
requirePattern(!/\b(?:fixture|mockData|staticData)\b/.test(clientText), "static authenticated fixture marker detected");
requirePattern(/command_receipts/.test(migration) && /get_admin_visit_report_v1/.test(migration), "required server contracts missing");
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Data-platform architecture invariants passed.");
