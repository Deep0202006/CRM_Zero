import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { git, inspectMigrationBoundaryTransition, parseArgs, root } from "./kernel-lib.mjs";

const required = ["AGENTS.md", "CLAUDE.md", ".codex/config.toml", ".codex/hooks.json", ".codex/rules/zerodata.rules", "docs/engineering/AUTHORITIES.json", "docs/engineering/CAPABILITIES.json", "docs/engineering/DOMAIN_MAP.json", "docs/engineering/PROOFS.json"];
const absent = ["check.js", "check_active.js", "check_cols.js", "check_users.js", "check_users_paginated.js", "diagnose_rpc.js", "verify_migrations.js", "scripts/seed-production-users.js", [".", "harness"].join(""), [".crm", "engineering"].join("-"), ["docs", "os"].join("/"), ["scripts", "harness"].join("/"), ["tools", "crm", "graph"].join("/"), ["docs", "engineering-graph"].join("/"), ["docs", "exec-plans"].join("/")];
export const doctor = ({ ci = false } = {}) => {
  const failures = [];
  if (!git("remote", "get-url", "origin").replace(/\.git$/, "").endsWith("Deep0202006/CRM_Zero")) failures.push("REPOSITORY_IDENTITY");
  if (!ci && git("branch", "--show-current") === "main") failures.push("MAIN_BRANCH_PROHIBITED");
  for (const path of required) if (!existsSync(resolve(root, path))) failures.push(`REQUIRED_PATH:${path}`);
  for (const path of absent) if (existsSync(resolve(root, path))) failures.push(`RETIRED_PATH:${path}`);
  if (existsSync(resolve(root, "CLAUDE.md")) && readFileSync(resolve(root, "CLAUDE.md"), "utf8").replaceAll("\r\n", "\n") !== "@AGENTS.md\n") failures.push("CLAUDE_ALIAS");
  let migration;
  try { migration = inspectMigrationBoundaryTransition(); }
  catch (error) { failures.push(error.message); }
  return { status: failures.length ? "SAFETY_CONFLICT" : "KERNEL_HEALTHY", repository: "Deep0202006/CRM_Zero", headSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}"), branch: git("branch", "--show-current"), migrationBoundary: migration?.migrationBoundary ?? "INVALID", immutableThrough: migration?.immutableThrough ?? null, nextLegalMigration: migration?.nextLegalMigration ?? null, transition: migration?.transition ?? "INVALID", failures };
};
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const result = doctor({ ci: parseArgs().has("--ci") });
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 2;
}
