import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = join(dir, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : extensions.has(extname(file)) ? [file] : [];
});
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const fail = (message) => { console.error(`invariant: ${message}`); process.exitCode = 1; };
for (const absolute of sourceFiles(join(root, "src"))) {
  const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
  const text = strip(readFileSync(absolute, "utf8"));
  if (relative.includes("/__tests__/") && !/(?:SUPABASE_SERVICE_ROLE_KEY|PRODUCTION_SUPABASE|\.env\.production)/i.test(text)) continue;
  const client = /^\s*["']use client["']/m.test(text) || (relative.endsWith(".tsx") && !relative.startsWith("src/app/api/"));
  if (/(?:delete\s+from\s+(?:public\.)?(?:call_logs|field_visits|receivables|receivable_payments)|\.from\(["'](?:call_logs|field_visits|receivables|receivable_payments)["']\)[\s\S]{0,240}?\.delete\s*\()/i.test(text)) fail(`${relative} deletes protected history`);
  if (/\b(?:localStorage\.clear|indexedDB\.deleteDatabase|(?:db\.)?(?:call_logs|field_visits|field_visit_media)\.clear)\s*\(/i.test(text)) fail(`${relative} clears durable recovery state`);
  if (client && /(?:SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|service_role|VAPID_PRIVATE_KEY)/i.test(text)) fail(`${relative} exposes a privileged secret`);
  if (client && /\.from\(["'](?:call_logs|field_visits)["']\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(text)) fail(`${relative} bypasses critical confirmation`);
  if (client && /\.from\(["'](?:receivables|receivable_payments)["']\)[\s\S]{0,300}?\.(?:insert|upsert|update|delete)\s*\(/i.test(text)) fail(`${relative} bypasses financial command authority`);
  if (client && /\.from\(["']leads["']\)[\s\S]{0,300}?\.update\s*\(/i.test(text)) fail(`${relative} bypasses Pipeline authority`);
  if ((relative.includes("/payments/") || relative.includes("/pipeline/") || relative.includes("/distributors/")) && /\.select\(\s*["'`]\*["'`]\s*\)/i.test(text)) fail(`${relative} uses SELECT * on a protected hot path`);
  if ((relative.includes("/payments/") || relative.includes("/pipeline/") || relative.includes("/distributors/")) && /\bsetInterval\s*\(/.test(text)) fail(`${relative} polls a protected business screen`);
}
const read = (file) => readFileSync(join(root, file), "utf8");
const pipelineServer = read("src/app/api/pipeline/server.ts");
if (!pipelineServer.includes(".range(start, start + pageSize - 1)") || /\.select\(\s*["'`]\*["'`]\s*\)/.test(pipelineServer)) fail("Pipeline server list must remain bounded and explicit");
if (/\.from\(["']leads["']\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(read("src/app/api/call-logs/confirm/route.ts"))) fail("Call confirmation cannot create Leads");
const mapping = read("src/app/mappings/page.tsx");
if (/transactionalMutation\(\s*["'`]leads|\.from\(["']leads["']\)[\s\S]{0,300}?\.(?:insert|upsert|update)/i.test(mapping)) fail("Mapping cannot mutate Leads");
for (const file of ["src/app/api/field-visits/mine/route.ts", "src/app/api/admin/visits/route.ts", "src/app/api/admin/export-visits/route.ts"]) if (!existsSync(join(root, file))) fail(`Field Visit read closure missing: ${file}`);
for (const file of readdirSync(root).filter((name) => /^owner-.*\.sql$/i.test(name))) if (/^\s*\\/m.test(read(file))) fail(`${file} is not pure PostgreSQL`);
for (const absolute of sourceFiles(join(root, "src"))) {
  const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
  if (relative.includes("/__tests__/")) continue;
  const source = strip(readFileSync(absolute, "utf8"));
  if (/\.from\(["']leads["']\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(source) && relative !== "src/app/api/pipeline/create/route.ts") fail(`${relative} bypasses canonical Lead creation`);
}
for (const absolute of sourceFiles(join(root, "scripts/engineering"))) {
  const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
  const source = readFileSync(absolute, "utf8");
  if (relative !== "scripts/engineering/os-acceptance.mjs" && /--updateSnapshot|--update-snapshot|updateSnapshot\s*\(/.test(source)) fail(`${relative} automates assertion/snapshot acceptance`);
  if (/(?:execFileSync|spawnSync)[\s\S]{0,300}gwfjkpsoaoherntwhdyf[\s\S]{0,300}(?:push|reset|insert|update|delete|apply)/i.test(source)) fail(`${relative} contains a production mutation runner`);
}
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
for (const path of tracked) {
  const content = readFileSync(join(root, path), "utf8");
  if (/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i.test(content)) fail(`${path} tracks private key material`);
  if (/^dist\/handover\/|^\.handover-owner\/|^\.handover\//.test(path)) fail(`${path} tracks sealed handover artifact`);
}
for (const absolute of sourceFiles(join(root, "scripts/handover"))) {
  const relative = absolute.slice(root.length + 1).replaceAll("\\", "/"), source = readFileSync(absolute, "utf8");
  if (/supabase\s+(?:db\s+push|migration\s+up|link)|vercel\s+env\s+(?:add|rm)|(?:dns|route53)\s+(?:change|update)/i.test(source)) fail(`${relative} contains prohibited platform mutation command`);
}
if (process.exitCode) process.exit(process.exitCode);
console.log("Invariant checks passed.");
