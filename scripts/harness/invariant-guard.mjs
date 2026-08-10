import { existsSync, readFileSync } from "node:fs";
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
  ];
  const hits = [];
  for (const [label, regex] of rules) for (const match of compact.matchAll(regex)) if (match) hits.push(label);

  const clientCode = /(^|\n)\s*["']use client["']/.test(text) || (!file.startsWith("src/app/api/") && (file.endsWith(".tsx") || file.includes("/components/")));
  if (clientCode && /(?:SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|service_role)/i.test(text)) hits.push("service-role secret reference in client code");
  if (clientCode && /\bVAPID_PRIVATE_KEY\b/.test(text)) hits.push("VAPID private key reference in client code");
  if (clientCode && /\.from\(\s*["'`](?:call_logs|field_visits)["'`]\s*\)[\s\S]{0,300}?\.(?:insert|upsert)\s*\(/i.test(text)) hits.push("direct browser critical write bypasses confirmation API");

  const normalizedFile = file.replaceAll("\\", "/").toLowerCase();
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
if (failed) process.exit(1);
console.log(`Invariant guard passed (${files.length} executable changed files scanned differentially).`);
