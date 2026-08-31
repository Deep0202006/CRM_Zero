import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { git, parseArgs, root } from "./kernel-lib.mjs";

const list = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 << 20 }).trim().split(/\r?\n/).filter(Boolean).map((path) => path.replaceAll("\\", "/"));
const matches = (path, expression) => expression.test(path);
export const auditWorkspace = () => {
  const changed = list(["diff", "--name-only", "origin/main", "--"]), product = changed.filter((path) => matches(path, /^(?:src|public|e2e|supabase)\//)), auth = product.filter((path) => /(?:auth|login|session)/i.test(path)), supabase = changed.filter((path) => /^supabase\//.test(path)), migrations = changed.filter((path) => /^supabase\/migrations\//.test(path)), vercel = changed.filter((path) => /^(?:vercel\.json|next\.config\.|middleware\.|proxy\.)/.test(path));
  const packageChanged = changed.includes("package.json"), basePackage = JSON.parse(git("show", "origin/main:package.json")), currentPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")), dependencyDelta = packageChanged && JSON.stringify([basePackage.dependencies, basePackage.devDependencies, basePackage.optionalDependencies, basePackage.peerDependencies]) !== JSON.stringify([currentPackage.dependencies, currentPackage.devDependencies, currentPackage.optionalDependencies, currentPackage.peerDependencies]);
  return { branch: git("branch", "--show-current"), headSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}"), clean: list(["status", "--porcelain=v1"]).length === 0, changedFiles: changed, zeros: { PRODUCT_RUNTIME_FILES_CHANGED: product.length, AUTH_LOGIN_FILES_CHANGED: auth.length, SUPABASE_FILES_CHANGED: supabase.length, MIGRATION_FILES_CHANGED: migrations.length, RUNTIME_DEPENDENCIES_CHANGED: dependencyDelta ? 1 : 0, VERCEL_CONFIG_FILES_CHANGED: vercel.length, PRODUCTION_CONTACT: 0, PRODUCTION_WRITES: 0, DEPLOYMENTS_PERFORMED: 0, MERGES_PERFORMED: 0 } };
};
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) { const result = auditWorkspace(); if (parseArgs().value("--mode") === "test") for (const [name, value] of Object.entries(result.zeros)) assert.equal(value, 0, name); console.log(JSON.stringify(result, null, 2)); if (Object.values(result.zeros).some(Boolean)) process.exitCode = 2; }
