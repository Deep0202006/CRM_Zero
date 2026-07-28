import { globMatch, listFiles, readJson, safeRead } from "./cli.mjs";

const policy = readJson("harness/policy.json");
const roots = ["src", "scripts", "tests", "docs", ".github", "supabase"];
const files = [...new Set([...roots.flatMap(listFiles), ...listFiles().filter((file) => !file.includes("/") && /\.(?:js|mjs|cjs|ts|py)$/.test(file))])].sort();
const failures = [];
const allow = (file, pattern) => policy.securityAllowlist.some((entry) =>
  globMatch(file, entry.path) && entry.pattern === pattern && new Date(entry.expiry) > new Date()
);
const detectors = [
  ["SUPABASE_SERVICE_ROLE_KEY", /SUPABASE_SERVICE_ROLE_KEY/],
  ["manual-env-parse", /readFileSync\s*\(\s*["']\.env(?:\.local)?["']/],
  ["jwt-value", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["password-db-url", /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["credential-auth-header", /Authorization\s*:\s*["'](?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{12,}/i]
];
for (const file of files) {
  if (/\.(?:zip|7z|rar)$/i.test(file) && /(?:repair|forensic|handoff|package)/i.test(file)) failures.push(`${file}: repair archive committed`);
  const text = safeRead(file);
  if (!text) continue;
  for (const [name, expression] of detectors) if (expression.test(text) && !allow(file, name === "SUPABASE_SERVICE_ROLE_KEY" ? name : name)) failures.push(`${file}: ${name}`);
  if (!file.includes("/api/") && /createClient\([^)]*serviceRole/i.test(text)) failures.push(`${file}: client-side admin bypass`);
  if (/public\s*:\s*true[\s\S]{0,100}visit.?evidence/i.test(text)) failures.push(`${file}: public visit evidence`);
  if (/console\.(?:log|error)\([^)]*(?:payload|coordinates|token|customer|notes)/i.test(text)) failures.push(`${file}: potentially private logging`);
}
if (failures.length) {
  console.error([...new Set(failures)].map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Security guard passed (${files.length} files scanned).`);
