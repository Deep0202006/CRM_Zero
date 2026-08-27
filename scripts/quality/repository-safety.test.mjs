import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, CommandClass } from "../engineering/command-policy.mjs";

const scanner = resolve(dirname(fileURLToPath(import.meta.url)), "repository-safety.mjs");
const join = (...parts) => parts.join("");
const runFixture = (files) => {
  const root = mkdtempSync(resolve(tmpdir(), "repository-safety-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    for (const [path, content] of Object.entries(files)) {
      const absolute = resolve(root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    const add = spawnSync("git", ["add", "-f", "--all"], { cwd: root, encoding: "utf8" });
    if (add.status !== 0) throw Error("FIXTURE_GIT_ADD_FAILED");
    return spawnSync(process.execPath, [scanner, "--root", root], { cwd: root, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const expectFailure = (name, code, files) => {
  const result = runFixture(files);
  if (result.status !== 1 || !result.stderr.includes(code)) throw Error(`${name}_NOT_BLOCKED`);
  return { name, expected: code, outcome: "BLOCKED" };
};
const expectPass = (name, files) => {
  const result = runFixture(files);
  if (result.status !== 0) throw Error(`${name}_FALSE_POSITIVE:${result.stderr}`);
  return { name, expected: "PASS", outcome: "PASS" };
};

const matrix = [
  expectFailure("hardcoded-password", "HARDCODED_PASSWORD", {
    "tools/create-admin.mjs": join('const DEFAULT_', 'PASS', 'WORD = process.env.ADMIN_', 'PASS', 'WORD || "synthetic-invalid-only"; client.auth.admin.create', 'User({ email, pass', 'word: DEFAULT_', 'PASS', 'WORD });\n'),
  }),
  expectFailure("unquoted-yaml-password", "HARDCODED_PASSWORD", {
    ".github/workflows/unsafe.yml": join("env:\n  ADMIN_", "PASSWORD: synthetic-invalid-only\n"),
  }),
  expectFailure("json-password", "HARDCODED_PASSWORD", {
    "docs/engineering/unsafe.json": join('{"ADMIN_', 'PASS', 'WORD":"synthetic-invalid-only"}\n'),
  }),
  expectFailure("hardcoded-service-role", "HARDCODED_SERVICE_ROLE", {
    "tools/key.mjs": join('const SUPABASE_SERVICE_', 'ROLE_KEY = "synthetic-invalid-service-role";\n'),
  }),
  expectFailure("default-admin-creation", "DEFAULT_ADMIN_CREATION", {
    "tools/bootstrap.mjs": join('const seeded', 'Admin = true; client.auth.admin.create', 'User({ email });\n'),
  }),
  expectFailure("service-role-outside-allowlist", "SERVICE_ROLE_NOT_ALLOWLISTED", {
    "tools/privileged.mjs": join("const key = process.env.SUPABASE_SERVICE_", "ROLE_KEY;\n"),
  }),
  expectFailure("env-local-privileged-client", "ENV_LOCAL_PRIVILEGED_CLIENT", {
    "tools/scratch-client.mjs": join('readFileSync(".env.', 'local"); createClient(url, process.env.SUPABASE_SERVICE_', 'ROLE_KEY);\n'),
  }),
  expectFailure("destructive-diagnostic", "DESTRUCTIVE_DIAGNOSTIC", {
    "tools/diagnose-db.mjs": 'await client.query("DELETE FROM synthetic_fixture");\n',
  }),
  expectFailure("root-check-recurrence", "OPERATIONAL_SCRATCH_PATH", {
    "check-again.js": "process.exit(0);\n",
  }),
  expectFailure("quality-production-mutation", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/quality/publish.mjs": join('execFileSync("supa', 'base", ["db", "push"]);\n'),
  }),
  expectFailure("indirect-quality-production-mutation", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/quality/publish-indirect.mjs": join('const cli = "supa', 'base"; spawnSync(cli, ["db", "push"]);\n'),
  }),
  expectFailure("async-quality-production-mutation", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/quality/publish-async.mjs": join('spawn("supa', 'base", ["db", "push"]);\n'),
  }),
  expectFailure("shell-database-mutation", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/engineering/unsafe.sh": join('ps', 'ql --command "TRUNCATE synthetic_fixture"\n'),
  }),
  expectFailure("package-runner-production-mutation", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/engineering/unsafe-runner.sh": join('pnpm exec ver', 'cel --prod\n'),
  }),
  expectFailure("prefixed-shell-production-mutation", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/quality/unsafe-shell.mjs": join('exec("cd fixture && ver', 'cel --prod");\n'),
  }),
  expectFailure("client-privileged-secret", "CLIENT_PRIVILEGED_SECRET", {
    "src/components/leak.tsx": join('\"use client\"; const key = process.env.SUPABASE_SERVICE_', 'ROLE_KEY;\n'),
  }),
  expectFailure("machine-absolute-path", "MACHINE_ABSOLUTE_PATH", {
    "docs/engineering/runbook.md": join("Run `node /ho", "me/fixture/danger.mjs`.\n"),
  }),
  expectFailure("generic-machine-absolute-path", "MACHINE_ABSOLUTE_PATH", {
    "scripts/engineering/tool.mjs": join('const binary = "/custom-', 'host/local/tool";\n'),
  }),
  expectFailure("governance-json-machine-path", "MACHINE_ABSOLUTE_PATH", {
    "docs/engineering/cache.json": join('{"tool":"/ho', 'me/fixture/bin/tool"}\n'),
  }),
  expectFailure("governance-dependency-tree", "GOVERNANCE_DEPENDENCY_TREE", {
    ".codex/node_modules/example/index.js": "export {};\n",
  }),
  expectFailure("agent-dependency-tree", "GOVERNANCE_DEPENDENCY_TREE", {
    ".agents/node_modules/example/index.js": "export {};\n",
  }),
  expectFailure("governance-lockfile", "GOVERNANCE_DEPENDENCY_TREE", {
    "docs/engineering/package-lock.json": "{}\n",
  }),
  expectFailure("removed-command-reference", "REMOVED_OPERATIONAL_COMMAND", {
    "docs/operations/runbook.md": join("Run `node scripts/seed-production-", "users.js`.\n"),
  }),
  expectFailure("hook-removed-command-reference", "REMOVED_OPERATIONAL_COMMAND", {
    "scripts/engineering/hooks/preflight.mjs": join('spawnSync(process.execPath, ["scripts/seed-production-', 'users.js"]);\n'),
  }),
  expectFailure("diagnostic-command-reference", "REMOVED_OPERATIONAL_COMMAND", {
    "docs/operations/runbook.md": join("Run `node diagnose_", "rpc.js`.\n"),
  }),
  expectFailure("extensionless-hook-removed-command-reference", "REMOVED_OPERATIONAL_COMMAND", {
    ".husky/pre-commit": join('node scripts/seed-production-', 'users.js\n'),
  }),
  expectFailure("python-root-scratch", "OPERATIONAL_SCRATCH_PATH", {
    "check_database.py": "raise SystemExit(0)\n",
  }),
  expectFailure("extensionless-root-scratch", "OPERATIONAL_SCRATCH_PATH", {
    "diagnose-database": "exit 0\n",
  }),
  expectFailure("python-destructive-diagnostic", "DESTRUCTIVE_DIAGNOSTIC", {
    "tools/diagnose-data.py": 'cursor.execute("UPDATE synthetic_fixture SET flag = true")\n',
  }),
  expectFailure("sql-string-comment-bypass", "DESTRUCTIVE_DIAGNOSTIC", {
    "tools/diagnose-data.sql": "SELECT 'https://synthetic.invalid'; DELETE FROM synthetic_fixture;\n",
  }),
  expectFailure("sql-dollar-comment-bypass", "DESTRUCTIVE_DIAGNOSTIC", {
    "tools/diagnose-dollar.sql": "SELECT $$-- synthetic$$; DELETE FROM synthetic_fixture;\n",
  }),
  expectFailure("deno-removed-command-reference", "REMOVED_OPERATIONAL_COMMAND", {
    "docs/operations/runbook.md": join("Run `deno scripts/seed-production-", "users.js`.\n"),
  }),
  expectFailure("scanner-self-content", "PRODUCTION_MUTATION_COMMAND", {
    "scripts/quality/repository-safety.mjs": join('execFileSync("supa', 'base", ["db", "push"]);\n'),
  }),
  expectPass("reviewed-server-service-role", {
    "src/app/api/admin/create-user/route.ts": join("const key = process.env.SUPABASE_SERVICE_", "ROLE_KEY;\n"),
  }),
  expectPass("comments-are-not-proof", {
    "tools/safe.mjs": join('// pass', 'word: "synthetic-invalid-only"; node scripts/seed-production-', 'users.js; supa', 'base db push\nexport const safe = true;\n'),
  }),
  expectPass("python-comments-are-not-proof", {
    "tools/safe.py": join('# SUPABASE_SERVICE_', 'ROLE_KEY and DELETE FROM synthetic_fixture\nvalue = True\n'),
  }),
  expectFailure("url-string-does-not-hide-code", "HARDCODED_PASSWORD", {
    "tools/url.mjs": join('const url = "https://synthetic.invalid"; const ADMIN_', 'PASS', 'WORD = "synthetic-invalid-only";\n'),
  }),
  expectPass("ordinary-server-update", {
    "src/app/api/example/route.ts": 'await client.from("synthetic").update({ safe: true });\n',
  }),
];

for (const [name, command, expected] of [
  ["policy-node-inline", "node -e process.exit(0)", CommandClass.PROHIBITED],
  ["policy-python-inline", "python -c open('x','w')", CommandClass.PROHIBITED],
  ["policy-shell-redirect", "printf fixture > file", CommandClass.PROHIBITED],
  ["policy-git-refspec-main", "git push origin HEAD:refs/heads/main", CommandClass.PROHIBITED],
  ["policy-git-force-tail", "git push origin feature/x --force", CommandClass.PROHIBITED],
  ["policy-supabase-parameter", "supabase --project-ref X db push", CommandClass.PROHIBITED],
  ["policy-supabase-wrapper", "npm exec -- supabase db push", CommandClass.PROHIBITED],
  ["policy-vercel-wrapper", "npx vercel deploy", CommandClass.PROHIBITED],
  ["policy-read-only", "git status --short", CommandClass.READ_ONLY_ALLOWED],
  ["policy-feature-push", "git push origin chore/engineering-kernel-v4", CommandClass.SCOPED_MUTATION_ALLOWED],
]) {
  const actual = classifyCommand(command);
  if (actual.classification !== expected) throw Error(`${name}:${actual.classification}:${actual.reason}`);
  matrix.push({ name, expected, outcome: actual.classification });
}

console.log(JSON.stringify({ code: "REPOSITORY_SAFETY_FIXTURES_PASS", matrix }));
