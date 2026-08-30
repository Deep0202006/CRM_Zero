import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).trim();
export const run = (file, args, options = {}) => {
  const windowsNodeCli = process.platform === "win32" && ["npm", "npx"].includes(file) ? resolve(dirname(process.execPath), "node_modules/npm/bin", `${file}-cli.js`) : null;
  return spawnSync(windowsNodeCli ? process.execPath : file, windowsNodeCli ? [windowsNodeCli, ...args] : args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.inherit ? "inherit" : "pipe",
    maxBuffer: 64 << 20,
  });
};
export const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
export const parseArgs = (args = process.argv.slice(2)) => ({
  has: (flag) => args.includes(flag),
  value: (flag, fallback) => {
    const index = args.indexOf(flag);
    return index < 0 ? fallback : args[index + 1];
  },
});
export const dirtyFingerprint = (cwd = root) => {
  const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd });
  const digest = createHash("sha256").update(status);
  const entries = status.toString("utf8").split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index], path = entry.slice(3);
    const absolute = resolve(cwd, path);
    if (existsSync(absolute)) digest.update(readFileSync(absolute));
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
  }
  return digest.digest("hex");
};
export const repositoryIdentity = (cwd = root, base = "origin/main") => ({
  headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
  treeSha: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim(),
  baseSha: execFileSync("git", ["rev-parse", base], { cwd, encoding: "utf8" }).trim(),
  dirtyFingerprint: dirtyFingerprint(cwd),
});
export const safeEnvironment = (source = process.env) => {
  const blocked = /^(?:PG[A-Z0-9_]*|GITHUB_TOKEN|GH_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|ACTIONS_RUNTIME_TOKEN|ACTIONS_RUNTIME_URL|ACTIONS_CACHE_URL|ACTIONS_RESULTS_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|DATABASE_URL|POSTGRES_URL.*|PRODUCTION_.*|VERCEL_TOKEN|AWS_SECRET_ACCESS_KEY|AZURE_.*|CLOUDFLARE_API_TOKEN)$/i;
  const safe = Object.fromEntries(Object.entries(source).filter(([key]) => !blocked.test(key)));
  if (source.NEXT_PUBLIC_SUPABASE_URL === "https://e2e.supabase.co") safe.NEXT_PUBLIC_SUPABASE_URL = source.NEXT_PUBLIC_SUPABASE_URL;
  if (source.NEXT_PUBLIC_SUPABASE_ANON_KEY === "e2e-anon-key") safe.NEXT_PUBLIC_SUPABASE_ANON_KEY = source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return safe;
};
export const environmentPolicyHash = () =>
  sha256(JSON.stringify({ inherit: "core", network: false, excluded: ["PG*", "GITHUB_TOKEN", "GH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL", "ACTIONS_CACHE_URL", "ACTIONS_RESULTS_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DATABASE_URL", "POSTGRES_URL*", "PRODUCTION_*", "VERCEL_TOKEN", "AWS_SECRET_ACCESS_KEY", "AZURE_*", "CLOUDFLARE_API_TOKEN"], postgres: { host: "127.0.0.1", port: "5432", user: "postgres", sslmode: "disable", disposable: true } }));

const migrationLedgerPath = "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json";
const migrationError = (code, detail) => new Error(detail ? `${code}:${detail}` : code);
export const parseMigrationNumber = (path) => {
  const match = /^supabase\/migrations\/(\d+)_([^/]+)\.sql$/.exec(String(path).replaceAll("\\", "/"));
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) return null;
  return Number(match[1]);
};
export const validateMigrationLedger = (ledger) => {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger) || ledger.schemaVersion !== 1 || typeof ledger.source !== "string" || !ledger.source.trim() || !Number.isInteger(ledger.lastAppliedOwnerMigration) || ledger.lastAppliedOwnerMigration <= 0 || !Number.isInteger(ledger.immutableThrough) || ledger.immutableThrough <= 0 || ledger.lastAppliedOwnerMigration !== ledger.immutableThrough) throw migrationError("MIGRATION_LEDGER_INVALID");
  return ledger;
};
export const isBaseImmutableMigrationPath = (path, baseImmutableThrough) => {
  const number = parseMigrationNumber(path);
  return number !== null && number <= baseImmutableThrough;
};
const requireUniqueMigrationNumbers = (paths) => {
  const seen = new Map();
  for (const path of paths) {
    const number = parseMigrationNumber(path);
    if (number === null) continue;
    if (seen.has(number)) throw migrationError("DUPLICATE_MIGRATION_NUMBER", number);
    seen.set(number, path);
  }
  return seen;
};
const requireBoundaryMigration = (migrations, boundary) => {
  const path = migrations.get(boundary);
  if (!path) throw migrationError("CERTIFIED_MIGRATION_MISSING", boundary);
  const expected = `${String(boundary).padStart(3, "0")}_`;
  if (!path.replaceAll("\\", "/").split("/").at(-1).startsWith(expected)) throw migrationError("CERTIFIED_MIGRATION_IDENTITY_INVALID", path);
};
export const validateMigrationBoundaryTransition = ({ baseLedger, headLedger, baseMigrationPaths = [], headMigrationPaths = [], changes = [] }) => {
  const base = validateMigrationLedger(baseLedger), head = validateMigrationLedger(headLedger), baseBoundary = base.immutableThrough, headBoundary = head.immutableThrough;
  if (headBoundary < baseBoundary) throw migrationError("MIGRATION_BOUNDARY_ROLLBACK", `${baseBoundary}->${headBoundary}`);
  if (headBoundary > baseBoundary + 1) throw migrationError("MIGRATION_BOUNDARY_JUMP", `${baseBoundary}->${headBoundary}`);
  const baseMigrations = requireUniqueMigrationNumbers(baseMigrationPaths), headMigrations = requireUniqueMigrationNumbers(headMigrationPaths);
  for (const entry of changes) {
    const oldNumber = parseMigrationNumber(entry.oldPath), newNumber = parseMigrationNumber(entry.path);
    if (headBoundary === baseBoundary + 1 && /^[RC]$/.test(entry.status) && ((newNumber === headBoundary && oldNumber !== headBoundary) || (oldNumber === headBoundary && newNumber !== headBoundary))) throw migrationError("CERTIFIED_MIGRATION_IDENTITY_INVALID", `${entry.oldPath}->${entry.path}`);
    if ([entry.oldPath, entry.path].some((path) => path && isBaseImmutableMigrationPath(path, baseBoundary))) throw migrationError("IMMUTABLE_MIGRATION_CHANGED", entry.oldPath ?? entry.path);
  }
  requireBoundaryMigration(baseMigrations, baseBoundary);
  requireBoundaryMigration(headMigrations, headBoundary);
  return {
    migrationBoundary: `${head.lastAppliedOwnerMigration}/${head.immutableThrough}`,
    baseImmutableThrough: baseBoundary,
    immutableThrough: headBoundary,
    nextLegalMigration: headBoundary + 1,
    transition: headBoundary === baseBoundary ? "STABLE_CURRENT_BOUNDARY" : "LEGAL_SINGLE_STEP_CERTIFICATION",
  };
};
const parseMigrationChanges = (buffer) => {
  const tokens = buffer.toString("utf8").split("\0").filter(Boolean), entries = [];
  for (let index = 0; index < tokens.length;) {
    const raw = tokens[index++], status = raw[0];
    if (/[RC]/.test(status)) entries.push({ status, oldPath: tokens[index++], path: tokens[index++] });
    else entries.push({ status, path: tokens[index++] });
  }
  return entries;
};
export const inspectMigrationBoundaryTransition = ({ cwd = root, base = "origin/main", head = "WORKTREE" } = {}) => {
  const headRevision = head === "WORKTREE" ? "HEAD" : head;
  const baseSha = execFileSync("git", ["merge-base", base, headRevision], { cwd, encoding: "utf8" }).trim();
  const readLedger = (revision) => {
    try { return revision === "WORKTREE" ? JSON.parse(readFileSync(resolve(cwd, migrationLedgerPath), "utf8")) : JSON.parse(execFileSync("git", ["show", `${revision}:${migrationLedgerPath}`], { cwd, encoding: "utf8" })); }
    catch { throw migrationError("MIGRATION_LEDGER_INVALID", revision); }
  };
  const listMigrations = (revision) => (revision === "WORKTREE" ? execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", "supabase/migrations"], { cwd }) : execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", revision, "--", "supabase/migrations"], { cwd })).toString("utf8").split("\0").filter((path) => path && (revision !== "WORKTREE" || existsSync(resolve(cwd, path))));
  const committed = parseMigrationChanges(execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", "--find-copies", `${baseSha}...${headRevision}`, "--", "supabase/migrations"], { cwd }));
  const working = head === "WORKTREE" ? parseMigrationChanges(execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", "--find-copies", "HEAD", "--", "supabase/migrations"], { cwd })) : [];
  const untracked = head === "WORKTREE" ? execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", "supabase/migrations"], { cwd }).toString("utf8").split("\0").filter(Boolean).map((path) => ({ status: "A", path })) : [];
  return { baseSha, ...validateMigrationBoundaryTransition({ baseLedger: readLedger(baseSha), headLedger: readLedger(head), baseMigrationPaths: listMigrations(baseSha), headMigrationPaths: listMigrations(head), changes: [...committed, ...working, ...untracked] }) };
};
