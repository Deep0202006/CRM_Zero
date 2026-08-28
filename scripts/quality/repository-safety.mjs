import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const reviewedServiceRolePaths = new Set([
  ".codex/config.toml",
  ".github/workflows/product-verification.yml",
  "scripts/distributor-status-db/run-integration.sh",
  "scripts/handover/check.mjs",
  "scripts/handover/lib.mjs",
  "scripts/engineering/hooks/pre-tool.mjs",
  "scripts/engineering/kernel-lib.mjs",
  "scripts/quality/invariants.mjs",
  "scripts/quality/repository-safety.mjs",
  "scripts/receivables-db/run-integration.sh",
  "src/app/api/admin/attendance/route.ts",
  "src/app/api/admin/create-user/route.ts",
  "src/app/api/admin/delete-user/route.ts",
  "src/app/api/admin/erp-partners/route.ts",
  "src/app/api/admin/export-visits/route.ts",
  "src/app/api/admin/reset-password/route.ts",
  "src/app/api/admin/update-user/route.ts",
  "src/app/api/admin/visits/erp-analytics/route.ts",
  "src/app/api/admin/visits/erp-baselines/route.ts",
  "src/app/api/admin/visits/evidence/route.ts",
  "src/app/api/admin/visits/route.ts",
  "src/app/api/attendance/clock-out/route.ts",
  "src/app/api/attendance/confirm/route.ts",
  "src/app/api/attendance/mine/route.ts",
  "src/app/api/call-logs/confirm/route.ts",
  "src/app/api/call-logs/history/route.ts",
  "src/app/api/field-visits/confirm/route.ts",
  "src/app/api/field-visits/erp-options/route.ts",
  "src/app/api/field-visits/mine/route.ts",
  "src/app/api/maintenance/initial-selfie-purge/route.ts",
  "src/app/api/maintenance/selfie-retention/route.ts",
  "src/app/api/my-day/daily-summary/route.ts",
  "src/app/api/my-day/payment-followups/route.ts",
  "src/app/api/pipeline/server.ts",
  "src/app/api/team-kpi/route.ts",
  "src/lib/__tests__/attendanceWriteReadClosure.test.ts",
  "src/lib/__tests__/currentErpBaseline.test.ts",
  "src/lib/__tests__/distributorMaster/payments.test.ts",
  "src/lib/__tests__/distributorMaster/receivables.test.ts",
  "src/lib/__tests__/distributors/canonicalCollectionRead.test.ts",
  "src/lib/__tests__/distributors/distributorReceivableActions.test.ts",
  "src/lib/__tests__/erpVisibilityContract.test.ts",
  "src/lib/__tests__/fieldVisitErpCompatibilitySecurity.test.ts",
  "src/lib/__tests__/fieldVisitZeroLossContract.test.ts",
  "src/lib/__tests__/receivables/financialSqlContract.test.ts",
  "src/lib/__tests__/receivables/isolation.test.ts",
  "src/lib/__tests__/receivables/productionCompletion.test.ts",
  "src/lib/__tests__/teamKpiApiContract.test.ts",
  "src/lib/__tests__/teamKpiMigration027.test.ts",
  "src/lib/receivables/server.ts",
  "src/lib/teamChat/server.ts",
]);
const reviewedServiceRoleReasons = new Map([...reviewedServiceRolePaths].map((path) => [path,
  path.startsWith("src/app/api/") || path.endsWith("/server.ts") ? "server-only authorization boundary" :
  path.includes("/__tests__/") ? "synthetic contract fixture" :
  path.startsWith("scripts/engineering/") || path.startsWith("scripts/quality/") || path.startsWith(".codex/") ? "credential isolation enforcement" :
  path.startsWith("scripts/handover/") ? "read-only handover verification" : "disposable CI integration",
]));
const reviewedDiagnosticPaths = new Set([
  "scripts/attendance-db/verify.sql",
  "scripts/handover/check.mjs",
  "scripts/handover/checksums.mjs",
  "scripts/mappings-db/verify.sql",
  "scripts/pipeline-db/verify-037.sql",
]);
const reviewedSyntheticCredentialPaths = new Set([
  "src/lib/__tests__/attendanceWriteReadClosure.test.ts",
]);

const sourceExtensions = new Set([
  ".bash", ".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".php", ".ps1", ".py", ".rb", ".rules", ".sh", ".sql", ".toml", ".ts", ".tsx", ".yaml", ".yml", ".zsh",
]);
const removedOperationalPaths = [
  "check.js",
  "check_active.js",
  "check_cols.js",
  "check_users.js",
  "check_users_paginated.js",
  "diagnose_rpc.js",
  "verify_migrations.js",
  "scripts/seed-production-users.js",
];

const stripCodeComments = (text) => {
  let result = "", quote = "", line = false, block = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (line) {
      if (char === "\n") { line = false; result += char; }
      continue;
    }
    if (block) {
      if (char === "*" && next === "/") { block = false; index += 1; }
      else if (char === "\n") result += char;
      continue;
    }
    if (quote) {
      result += char;
      if (char === "\\") result += text[++index] ?? "";
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; result += char; }
    else if (char === "/" && next === "/") { line = true; index += 1; }
    else if (char === "/" && next === "*") { block = true; index += 1; }
    else result += char;
  }
  return result;
};

const stripComments = (text, extension) => {
  if ([".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts", ".ts", ".tsx"].includes(extension))
    return stripCodeComments(text);
  if (extension === ".php") return stripHashComments(stripCodeComments(text));
  if (extension === ".sql")
    return stripSqlComments(text);
  if ([".bash", ".ps1", ".py", ".rb", ".rules", ".sh", ".toml", ".yaml", ".yml", ".zsh"].includes(extension))
    return stripHashComments(extension === ".ps1" ? text.replace(/<#[\s\S]*?#>/g, "") : text);
  return text;
};
const stripHashComments = (text) => {
  let result = "", quote = "", comment = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (comment) {
      if (char === "\n") { comment = false; result += char; }
      continue;
    }
    if (quote) {
      result += char;
      if (char === "\\") result += text[++index] ?? "";
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; result += char; }
    else if (char === "#") comment = true;
    else result += char;
  }
  return result;
};
const stripSqlComments = (text) => {
  let result = "", quote = "", dollar = "", line = false, block = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (line) {
      if (char === "\n") { line = false; result += char; }
      continue;
    }
    if (block) {
      if (char === "*" && next === "/") { block = false; index += 1; }
      else if (char === "\n") result += char;
      continue;
    }
    if (dollar) {
      if (text.startsWith(dollar, index)) { result += dollar; index += dollar.length - 1; dollar = ""; }
      else result += char;
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote && next === quote) result += text[++index];
      else if (char === quote) quote = "";
      continue;
    }
    const dollarMatch = text.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
    if (dollarMatch) { dollar = dollarMatch[0]; result += dollar; index += dollar.length - 1; }
    else if (char === "'" || char === '"') { quote = char; result += char; }
    else if (char === "-" && next === "-") { line = true; index += 1; }
    else if (char === "/" && next === "*") { block = true; index += 1; }
    else result += char;
  }
  return result;
};
const machineAbsolutePath = /\b[A-Za-z]:[\\/][^\s`"']+|[`"']\/(?!api(?:\/|$)|[/*])(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/;
const hasMachineAbsolutePath = (text, extension) => machineAbsolutePath.test(text) ||
  ([".bash", ".md", ".ps1", ".sh", ".zsh"].includes(extension) && /(?:^|\s)\/(?![/*])(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/m.test(text));
const jobBlock = (workflow, job) => {
  const marker = `\n  ${job}:\n`, start = workflow.indexOf(marker);
  if (start < 0) return "";
  const tail = workflow.slice(start + 1), next = tail.slice(marker.length - 1).search(/\n  [a-zA-Z0-9_-]+:\s*\n/);
  return next < 0 ? tail : tail.slice(0, marker.length - 1 + next);
};
const controlPlaneViolations = (path, text) => {
  const violations = [];
  if (path === ".github/workflows/product-verification.yml") {
    const attest = jobBlock(text, "attest-evidence"), verify = jobBlock(text, "verify");
    if (!attest || !attest.includes("actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6")) violations.push("ATTESTATION_JOB_MISSING_OR_UNPINNED");
    if (!["contents: read", "id-token: write", "attestations: write", "artifact-metadata: write"].every((permission) => attest.includes(permission)) || /actions\/checkout|npm\s+(?:ci|run)|scripts\//.test(attest)) violations.push("ATTESTATION_JOB_AUTHORITY_INVALID");
    for (const job of ["preflight", "unit-build", "receivables-postgres", "e2e"]) if (/id-token:\s*write|attestations:\s*write|artifact-metadata:\s*write/.test(jobBlock(text, job))) violations.push("PRODUCER_OIDC_PERMISSION");
    for (const directory of ["preflight", "unit-build", "receivables-postgres", "e2e"]) if (!text.includes(`artifacts/engineering-evidence/${directory}`)) violations.push("EVIDENCE_DIRECTORY_COLLISION");
    if (/merge-multiple:\s*true/.test(text) || !verify.includes("artifacts/engineering-attestation") || !verify.includes("kernel-evidence-attestation")) violations.push("EVIDENCE_DIRECTORY_COLLISION");
    if (!verify.includes("proof:certify-ci") || !verify.includes("GH_TOKEN:")) violations.push("ATTESTATION_VERIFICATION_MISSING");
  }
  if (path === "scripts/engineering/proof-certify-ci.mjs" && (!/spawnSync\(\s*["']gh["']/.test(text) || !["attestation", "verify", "--bundle", "--signer-workflow", "--deny-self-hosted-runners"].every((value) => text.includes(`"${value}"`)) || /export\s+(?:const|function)\s+certifyRepositoryProof/.test(text))) violations.push("CERTIFIER_ATTESTATION_BYPASS");
  if (path === "scripts/engineering/hooks/stop.mjs" && (/evidenceCurrent|artifacts\/engineering-evidence|LOCAL_PROOFS_REQUIRED/.test(text) || !text.includes("WORKTREE_DIRTY_COMMIT_REQUIRED"))) violations.push("STOP_SHALLOW_EVIDENCE_AUTHORITY");
  if (path === "scripts/engineering/kernel-lib.mjs" && (!text.includes("PG[A-Z0-9_]*") || !["GITHUB_TOKEN", "GH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_RUNTIME_TOKEN"].every((value) => text.includes(value)))) violations.push("PROOF_ENVIRONMENT_ISOLATION_MISSING");
  if (path === "scripts/engineering/proof-runner.mjs" && (!text.includes("disposablePostgresEnvironment") || !text.includes('kind === "postgres"'))) violations.push("POSTGRES_LOOPBACK_RECONSTRUCTION_MISSING");
  return [...new Set(violations)];
};

const trackedPaths = (root) => {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw Error("TRACKED_PATH_ENUMERATION_FAILED");
  return result.stdout.split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
};

export const scanRepository = (root) => {
  const violations = [], paths = trackedPaths(root);
  const fail = (code, path) => violations.push({ code, path });
  for (const path of paths) {
    if (!existsSync(resolve(root, path))) continue;
    const extension = extname(path).toLowerCase(), rootFile = !path.includes("/"),
      governancePath = /^(?:\.agents|\.codex|docs\/engineering|scripts\/(?:engineering|quality))\//i.test(path),
      governanceJson = governancePath && extension === ".json",
      hookPath = /(^|\/)(?:hooks?|\.husky|\.githooks)\//i.test(path),
      configJson = extension === ".json" && !/(^|\/)package-lock\.json$/i.test(path);
    if (governancePath && (/(^|\/)node_modules\//i.test(path) || /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i.test(path)))
      fail("GOVERNANCE_DEPENDENCY_TREE", path);
    if (
      (rootFile && /^(?:check|diagnose|verify)(?:[\w.-]*\.(?:bash|c?js|cts|mjs|mts|php|ps1|py|rb|sh|sql|ts|zsh)|[\w.-]*)$/i.test(path)) ||
      /(^|\/)seed-production(?:[\w.-]*\.(?:bash|c?js|cts|mjs|mts|php|ps1|py|rb|sh|sql|ts|zsh)|[\w.-]*)$/i.test(path)
    ) fail("OPERATIONAL_SCRATCH_PATH", path);
    if (!sourceExtensions.has(extension) && !["package.json", ".codex/hooks.json"].includes(path) && !path.endsWith(".md") && !configJson && !hookPath) continue;

    const raw = readFileSync(resolve(root, path), "utf8"), executable = stripComments(raw, extension);
    for (const code of controlPlaneViolations(path, executable)) fail(code, path);
    if (governanceJson) {
      if (hasMachineAbsolutePath(executable, extension))
        fail("MACHINE_ABSOLUTE_PATH", path);
    }
    if (path.endsWith(".md")) {
      if (/(?:^|[`>\s])(?:node|bun|deno|tsx|npx(?:\s+tsx)?|pnpm(?:\s+exec)?|yarn|bash|sh|pwsh|powershell)\s+(?:\.\/)?(?:check(?:_[\w-]+)?\.js|diagnose_rpc\.js|verify_migrations\.js|scripts\/seed-production-users\.js)\b|(?:^|[`>\s])\.\/(?:check(?:_[\w-]+)?\.js|diagnose_rpc\.js|verify_migrations\.js|scripts\/seed-production-users\.js)\b/im.test(executable))
        fail("REMOVED_OPERATIONAL_COMMAND", path);
      if (hasMachineAbsolutePath(executable, extension) && /^(?:docs\/engineering|docs\/operations|\.codex)\//.test(path))
        fail("MACHINE_ABSOLUTE_PATH", path);
      continue;
    }

    const credentialText = path === ".github/workflows/product-verification.yml"
      ? executable
          .replace(/\b(?:POSTGRES_PASSWORD|PGPASSWORD):\s*postgres\b/g, "")
          .replace(/\bSUPABASE_SERVICE_ROLE_KEY:\s*BUILD_TIME_PLACEHOLDER_KEY\b/g, "")
      : ["scripts/engineering/kernel.test.mjs", "scripts/engineering/proof-command-plan.mjs"].includes(path)
        ? executable.replace(/\bPGPASSWORD:\s*["'](?:postgres|secret)["']/g, "")
      : executable;
    const credentialIdentifierPattern = "[A-Za-z0-9_-]*(?:password|passwd)[A-Za-z0-9_-]*",
      assignmentStart = "(?:^|[\\n,{;])\\s*(?:(?:const|let|var)\\s+)?",
      quotedSecret = new RegExp(`${assignmentStart}[\"']?${credentialIdentifierPattern}[\"']?\\s*[:=]\\s*(?:process\\.env\\.[A-Z0-9_]+\\s*(?:\\|\\||\\?\\?)\\s*)?[\"'\\x60][^\"'\\x60\\r\\n]{4,}[\"'\\x60]`, "i"),
      plainYamlSecret = new RegExp(`^[ \\t]*${credentialIdentifierPattern}[ \\t]*:[ \\t]*(?!\\$\\{?|process\\.env|env\\.|secrets\\.)[^#\\s\"']{4,}[ \\t]*(?:#.*)?$`, "im"),
      hardcodedPassword = quotedSecret.test(credentialText) || ([".yaml", ".yml"].includes(extension) && plainYamlSecret.test(credentialText)),
      quotedServiceRole = new RegExp(`${assignmentStart}(?:(?:const|let|var)\\s+)?SUPABASE_SERVICE_ROLE(?:_KEY)?\\b\\s*[:=]\\s*[\"'\\x60][^\"'\\x60\\r\\n]{8,}[\"'\\x60]`, "i"),
      plainYamlServiceRole = /^\s*SUPABASE_SERVICE_ROLE(?:_KEY)?\s*:\s*(?!\$\{?|process\.env|env\.|secrets\.)[^#\s"']{8,}\s*(?:#.*)?$/im,
      hardcodedServiceRole = quotedServiceRole.test(credentialText) || ([".yaml", ".yml"].includes(extension) && plainYamlServiceRole.test(credentialText));
    const adminCreate = /auth\.admin\.createUser\s*\(/i.test(executable);
    if (hardcodedPassword) fail("HARDCODED_PASSWORD", path);
    if (hardcodedServiceRole && !reviewedSyntheticCredentialPaths.has(path)) fail("HARDCODED_SERVICE_ROLE", path);
    if (adminCreate && (hardcodedPassword || /\b(?:default|seed)(?:ed)?Admin\b/i.test(executable)))
      fail("DEFAULT_ADMIN_CREATION", path);

    const serviceRole = /SUPABASE_SERVICE_ROLE(?:_KEY)?|\bservice_role\b/i.test(executable);
    if (extension !== ".sql" && serviceRole && !reviewedServiceRoleReasons.has(path)) fail("SERVICE_ROLE_NOT_ALLOWLISTED", path);
    if (/\.env\.local\b/i.test(executable) && /createClient\s*\(/.test(executable) && serviceRole)
      fail("ENV_LOCAL_PRIVILEGED_CLIENT", path);

    const diagnostic = /(^|\/)(?:check|diagnose|verify|scratch|debug|seed)[\w.-]*\.(?:bash|c?js|cts|mjs|mts|php|ps1|py|rb|sh|sql|ts|zsh)$/i.test(path);
    if (diagnostic && !reviewedDiagnosticPaths.has(path) && /\b(?:DELETE\s+FROM|UPDATE\s+[\w."']+\s+SET|TRUNCATE(?:\s+TABLE)?|DROP\s+(?:TABLE|SCHEMA|DATABASE))\b|\.(?:delete|update)\s*\(/i.test(executable))
      fail("DESTRUCTIVE_DIAGNOSTIC", path);

    if (/^scripts\/(?:engineering|quality)\//.test(path)) {
      const launcher = "(?:execFileSync|spawnSync|execSync|execFile|spawn|exec)",
        mutation = "(?:prod|push|reset|deploy|delete|remove|set|unset|link|unlink|create|insert|upsert|update|truncate|drop|alter|grant|revoke)",
        directShellMutation = new RegExp(`^[ \\t]*(?:(?:npx|yarn|pnpm[ \\t]+exec)[ \\t]+)?(?:supabase|vercel|psql)\\b[^\\r\\n]*\\b${mutation}\\b`, "im").test(executable),
        directProductionMutation = new RegExp(`${launcher}\\s*\\([\\s\\S]{0,40}[\"'][^\"'\\r\\n]{0,120}\\b(?:supabase|vercel|psql)\\b[\\s\\S]{0,240}\\b${mutation}\\b`, "i").test(executable);
      const indirectProductionMutation = [...executable.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'](?:supabase|vercel|psql)["']/gi)]
        .some(([, variable]) => new RegExp(`${launcher}\\s*\\(\\s*${variable}\\b[\\s\\S]{0,240}\\b${mutation}\\b`, "i").test(executable));
      if (directShellMutation || directProductionMutation || indirectProductionMutation) fail("PRODUCTION_MUTATION_COMMAND", path);
    }

    const clientSource = path.startsWith("src/") && (/^\s*["']use client["']/m.test(executable) || (path.endsWith(".tsx") && !path.startsWith("src/app/api/")));
    if (clientSource && serviceRole) fail("CLIENT_PRIVILEGED_SECRET", path);

    if (hasMachineAbsolutePath(executable, extension) && /^(?:scripts\/(?:engineering|quality)|\.github|\.codex)\//.test(path))
      fail("MACHINE_ABSOLUTE_PATH", path);

    if (["package.json", ".codex/hooks.json"].includes(path) || path.startsWith(".github/workflows/") || hookPath)
      for (const removed of removedOperationalPaths)
        if (executable.includes(removed)) fail("REMOVED_OPERATIONAL_COMMAND", path);
  }
  return { paths, violations };
};

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const rootIndex = process.argv.indexOf("--root"), root = resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : resolve(import.meta.dirname, "../.."));
  const result = scanRepository(root);
  for (const violation of result.violations)
    console.error(`repository-safety: ${violation.code} ${violation.path}`);
  if (result.violations.length) process.exit(1);
  console.log(`Repository safety passed (${result.paths.length} tracked paths scanned).`);
}
