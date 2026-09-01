import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, CommandClass } from "../engineering/command-policy.mjs";
import { makeEngineeringTemp, removeEngineeringTemp } from "../engineering/managed-paths.mjs";

const scanner = resolve(dirname(fileURLToPath(import.meta.url)), "repository-safety.mjs");
const join = (...parts) => parts.join("");
const runFixture = (files) => {
  const root = makeEngineeringTemp("repository-safety");
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
    removeEngineeringTemp(root);
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
  expectPass("codex-config-without-model-selection", {
    ".codex/config.toml": 'approval_policy = "on-request"\n',
  }),
  expectFailure("codex-top-level-model", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": 'model = "synthetic-model"\n',
  }),
  expectFailure("codex-top-level-reasoning", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": 'model_reasoning_effort = "high"\n',
  }),
  expectFailure("codex-new-thread-model", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": '[models.new_thread]\nmodel = "synthetic-model"\n',
  }),
  expectFailure("codex-new-thread-reasoning", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": '[models.new_thread]\nmodel_reasoning_effort = "high"\n',
  }),
  expectFailure("codex-subagent-model", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": '[agents]\ndefault_subagent_model = "synthetic-model"\n',
  }),
  expectFailure("codex-subagent-reasoning", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": '[agents]\ndefault_subagent_reasoning_effort = "high"\n',
  }),
  expectFailure("codex-memory-extract-model", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": '[memories]\nextract_model = "synthetic-model"\n',
  }),
  expectFailure("codex-memory-consolidation-model", "CODEX_MODEL_SELECTION_PINNED", {
    ".codex/config.toml": '[memories]\nconsolidation_model = "synthetic-model"\n',
  }),
  expectFailure("command-short-model", "CODEX_MODEL_SELECTION_PINNED", {
    "package.json": join('{"scripts":{"co', 'dex":"co', 'dex -m synthetic-model"}}\n'),
  }),
  expectFailure("command-long-model", "CODEX_MODEL_SELECTION_PINNED", {
    "package.json": join('{"scripts":{"co', 'dex":"co', 'dex --model synthetic-model"}}\n'),
  }),
  expectFailure("command-config-model", "CODEX_MODEL_SELECTION_PINNED", {
    "package.json": join('{"scripts":{"co', 'dex":"co', 'dex -c model=\\"synthetic-model\\""}}\n'),
  }),
  expectPass("codex-model-documentation", {
    "docs/engineering/model.md": "GPT-5.6 may be selected by the Owner.\n",
  }),
  expectPass("codex-model-source-comment", {
    "tools/safe.mjs": "// Codex model choice belongs to the Owner.\nexport const safe = true;\n",
  }),
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
  expectPass("call-owner-update-server-boundary", {
    "src/app/api/call-logs/[log_id]/route.ts": join("const key = process.env.SUPABASE_SERVICE_", "ROLE_KEY;\n"),
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
  expectFailure("workflow-attestation-job-missing", "ATTESTATION_JOB_MISSING_OR_UNPINNED", {
    ".github/workflows/product-verification.yml": "name: unsafe\njobs:\n  preflight:\n    permissions:\n      contents: read\n",
  }),
  expectFailure("workflow-producer-oidc", "PRODUCER_OIDC_PERMISSION", {
    ".github/workflows/product-verification.yml": "name: unsafe\njobs:\n  preflight:\n    permissions:\n      id-token: write\n  attest-evidence:\n    permissions:\n      contents: read\n      id-token: write\n      attestations: write\n      artifact-metadata: write\n    steps:\n      - uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6\n",
  }),
  expectFailure("workflow-merged-evidence", "EVIDENCE_DIRECTORY_COLLISION", {
    ".github/workflows/product-verification.yml": "name: unsafe\njobs:\n  verify:\n    steps:\n      - uses: actions/download-artifact@fixture\n        with: { merge-multiple: true }\n",
  }),
  expectFailure("certifier-export-bypass", "CERTIFIER_ATTESTATION_BYPASS", {
    "scripts/engineering/proof-certify-ci.mjs": "export const certifyRepositoryProof = () => ({ status: 'REPOSITORY_PROOF_READY' });\n",
  }),
  expectFailure("stop-local-evidence-authority", "STOP_SHALLOW_EVIDENCE_AUTHORITY", {
    "scripts/engineering/hooks/stop.mjs": "const evidenceCurrent = () => true; const path = 'artifacts/engineering-evidence';\n",
  }),
  expectFailure("proof-environment-isolation", "PROOF_ENVIRONMENT_ISOLATION_MISSING", {
    "scripts/engineering/kernel-lib.mjs": "export const safeEnvironment = (source) => source;\n",
  }),
  expectFailure("postgres-loopback-reconstruction", "POSTGRES_LOOPBACK_RECONSTRUCTION_MISSING", {
    "scripts/engineering/proof-runner.mjs": "export const runProof = (environment) => environment;\n",
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../.."), workflowPath = ".github/workflows/product-verification.yml";
const workflowLf = readFileSync(resolve(repositoryRoot, workflowPath), "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const representations = {
  LF: workflowLf,
  CRLF: workflowLf.replace(/\n/g, "\r\n"),
  BOM_CRLF: `\uFEFF${workflowLf.replace(/\n/g, "\r\n")}`,
};
const workflowMutations = [
  ["attest-action", "ATTESTATION_JOB_MISSING_OR_UNPINNED", (text) => text.replace("actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6", "actions/attest@main")],
  ["attest-permission", "ATTESTATION_JOB_AUTHORITY_INVALID", (text) => text.replace("attestations: write", "attestations: read")],
  ["evidence-collision", "EVIDENCE_DIRECTORY_COLLISION", (text) => text.replaceAll("artifacts/engineering-evidence/e2e", "artifacts/engineering-evidence/preflight")],
  ["verification-command", "ATTESTATION_VERIFICATION_MISSING", (text) => text.replace("proof:certify-ci", "proof:certify")],
  ["producer-oidc", "PRODUCER_OIDC_PERMISSION", (text) => text.replace(/(  preflight:[\s\S]*?permissions:[\s\S]*?contents: read)/, "$1\n      id-token: write")],
];
for (const [representation, workflow] of Object.entries(representations)) {
  matrix.push(expectPass(`workflow-${representation.toLowerCase()}`, { [workflowPath]: workflow }));
  for (const [name, code, mutate] of workflowMutations)
    matrix.push(expectFailure(`workflow-${representation.toLowerCase()}-${name}`, code, { [workflowPath]: mutate(workflow) }));
}
const impersonated = workflowLf
  .replace(/^  attest-evidence:/m, "  attest-evidence-copy:")
  .replace(/^  verify:/m, "  verify-copy:")
  .concat("\n#   attest-evidence:\n#   verify:\n");
matrix.push(expectFailure("workflow-similarly-named-jobs-cannot-impersonate", "ATTESTATION_JOB_MISSING_OR_UNPINNED", { [workflowPath]: impersonated }));

for (const [name, command, expected] of [
  ["policy-node-inline", "node -e process.exit(0)", CommandClass.PROHIBITED],
  ["policy-python-inline", "python -c open('x','w')", CommandClass.PROHIBITED],
  ["policy-shell-redirect", "printf fixture > file", CommandClass.PROHIBITED],
  ["policy-git-refspec-main", "git push origin HEAD:refs/heads/main", CommandClass.PROHIBITED],
  ["policy-git-force-tail", "git push origin feature/x --force", CommandClass.PROHIBITED],
  ["policy-supabase-parameter", "supabase --project-ref X db push", CommandClass.PROHIBITED],
  ["policy-supabase-wrapper", "npm exec -- supabase db push", CommandClass.PROHIBITED],
  ["policy-vercel-wrapper", "npx vercel deploy", CommandClass.PROHIBITED],
  ["policy-github-merge", "gh pr merge 90 --repo Deep0202006/CRM_Zero --merge --match-head-commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", CommandClass.PROHIBITED],
  ["policy-vercel-deploy", "vercel deploy --prod --skip-domain", CommandClass.PROHIBITED],
  ["policy-vercel-promote", "vercel promote dpl_fixture", CommandClass.PROHIBITED],
  ["policy-vercel-rollback", "vercel rollback", CommandClass.PROHIBITED],
  ["policy-vercel-env", "vercel env pull", CommandClass.PROHIBITED],
  ["policy-vercel-domains", "vercel domains add example.invalid", CommandClass.PROHIBITED],
  ["policy-vercel-alias", "vercel alias dpl_fixture example.invalid", CommandClass.PROHIBITED],
  ["policy-read-only", "git status --short", CommandClass.READ_ONLY_ALLOWED],
  ["policy-feature-push", "git push origin chore/engineering-kernel-v4", CommandClass.SCOPED_MUTATION_ALLOWED],
  ["policy-branch-delete", "git branch -D feature/x", CommandClass.PROHIBITED],
  ["policy-remote-set-url", "git remote set-url origin https://example.invalid/repo.git", CommandClass.PROHIBITED],
  ["policy-worktree-remove", "git worktree remove .worktrees/x", CommandClass.PROHIBITED],
  ["policy-worktree-prune", "git worktree prune", CommandClass.PROHIBITED],
  ["policy-branch-list", "git branch --list", CommandClass.READ_ONLY_ALLOWED],
  ["policy-remote-read", "git remote get-url origin", CommandClass.READ_ONLY_ALLOWED],
  ["policy-worktree-list", "git worktree list --porcelain", CommandClass.READ_ONLY_ALLOWED],
  ["policy-worktree-add-scoped", "git worktree add .worktrees/x chore/x", CommandClass.SCOPED_MUTATION_ALLOWED],
]) {
  const actual = classifyCommand(command);
  if (actual.classification !== expected) throw Error(`${name}:${actual.classification}:${actual.reason}`);
  matrix.push({ name, expected, outcome: actual.classification });
}

console.log(JSON.stringify({ code: "REPOSITORY_SAFETY_FIXTURES_PASS", matrix }));
