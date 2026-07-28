import fs from "node:fs";
import path from "node:path";
import { args, changedFiles, globMatch, listFiles, loadAreas, readJson, root, safeRead } from "./cli.mjs";

const options = args();
const failures = [];
const fail = (message) => failures.push(message);
if (options.scope) {
  const boundaryFile = path.join(root, ".codex-artifacts/change-boundary.json");
  const stateFile = path.join(root, ".codex-artifacts/task-state.json");
  if (!fs.existsSync(boundaryFile) || !fs.existsSync(stateFile)) {
    if (process.env.CI) console.log("SKIPPED: scope metadata is not present.");
    else fail("Run harness:new before the scope check.");
  } else {
    const boundary = readJson(".codex-artifacts/change-boundary.json");
    const state = readJson(".codex-artifacts/task-state.json");
    const allowed = [...boundary.allowedPaths, ...(boundary.explicitlyApprovedAdditionalPaths ?? []), ...(state.explicitlyApprovedAdditionalPaths ?? [])];
    if (allowed.some((item) => item === "src/**") && !(state.riskLevel === "critical" && state.scopeJustification)) fail("Broad src/** scope requires critical risk and justification.");
    for (const file of changedFiles(state.baseCommit)) {
      if (file.startsWith(".codex-artifacts/")) fail(`Generated artifact is tracked or in diff: ${file}`);
      if (/^\.env(?:\.|$)/.test(file)) fail(`Environment file changed: ${file}`);
      if (/\.(?:zip|7z|rar)$/i.test(file) && /(?:repair|forensic|handoff|package)/i.test(file)) fail(`Repair archive changed: ${file}`);
      if (!allowed.some((pattern) => globMatch(file, pattern))) fail(`Out-of-scope file: ${file}`);
      if (/^supabase\/migrations\//.test(file) && !state.databaseChangeExpected) fail(`Migration changed in a no-database task: ${file}`);
      if (/^src\/app\/api\//.test(file) && !changedFiles(state.baseCommit).some((candidate) => candidate.startsWith("harness/contracts/") || /test|spec/.test(candidate))) fail(`Route contract changed without contract/test update: ${file}`);
    }
  }
}
if (options.architecture) {
  const files = listFiles("src").filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.includes("/__tests__/"));
  const migrationFiles = listFiles("supabase/migrations").filter((file) => file.endsWith(".sql"));
  const browser = files.filter((file) => !file.includes("/api/")).map((file) => safeRead(file)).join("\n");
  if (/SUPABASE_SERVICE_ROLE_KEY/.test(browser)) fail("Service-role reference in browser code.");
  const kpiApi = safeRead("src/app/api/team-kpi/route.ts");
  if (/get_team_kpi_daily_v[1-4]\b/.test(kpiApi) || /\.from\(["'](?:call_logs|client_queries|mapping_requests|tasks|allocated_targets)/.test(kpiApi)) fail("Legacy/raw Team KPI reporting path.");
  if (/activity[_ -]?deck/i.test(kpiApi)) fail("Activity Deck dependency.");
  const db = safeRead("src/lib/db.ts");
  if (/idempotency_key\s*:\s*(?:crypto\.randomUUID|uuidv4)/.test(db)) fail("Random outbox idempotency key.");
  if ((db.match(/addEventListener\(["']online/g) ?? []).length > 1) fail("Duplicate online sync listener.");
  if (/Pushing local data to restore remote/i.test(db)) fail("Remote-empty mass upload path.");
  const protectedText = readJson("harness/policy.json").protectedWorkflowFiles.map(safeRead).join("\n");
  if (/(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(protectedText)) fail("Native dialog in protected workflow.");
  const lock = readJson("harness/migrations.lock.json");
  const sql = migrationFiles.filter((file) => !lock.migrations[file]).map(safeRead).join("\n");
  if (/COALESCE\s*\(\s*(?:NEW\.)?(?:status|problem_status|outcome)\s*,\s*''/i.test(sql)) fail("Enum-unsafe SQL comparison.");
  const visits = safeRead("src/app/admin/visits/page.tsx");
  if (/createSignedUrl/.test(visits)) fail("Eager visit signed URL generation.");
  const auth = safeRead("src/context/AuthContext.tsx");
  if (!/unsynchronized\.total\s*>\s*0[\s\S]{0,500}signedOut:\s*false/.test(auth)) fail("Logout lacks queue-empty proof.");
}
if (!options.scope && !options.architecture) fail("Choose --scope or --architecture.");
if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(options.scope ? "Scope policy passed." : "Architecture policy passed.");
