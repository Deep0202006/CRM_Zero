import fs from "node:fs";
import path from "node:path";
import { artifacts, listFiles, normalize, root } from "./cli.mjs";

const output = path.join(artifacts, "ci-evidence");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const redact = (value) => value
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
  .replace(/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi, "postgresql://[REDACTED]@")
  .replace(/(Authorization:\s*)(?:Bearer|Basic)\s+\S+/gi, "$1[REDACTED]")
  .replace(/(SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
const candidates = listFiles(".codex-artifacts").filter((file) =>
  !file.startsWith(".codex-artifacts/ci-evidence/") &&
  /\.(?:json|md|log|txt)$/.test(file)
);
for (const file of candidates) {
  const source = path.join(root, file);
  if (fs.statSync(source).size > 2 * 1024 * 1024) continue;
  const target = path.join(output, file.replace(".codex-artifacts/", ""));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, redact(fs.readFileSync(source, "utf8")));
}
fs.writeFileSync(path.join(output, "toolchain.json"), `${JSON.stringify({
  node: process.version,
  npm: process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1] ?? "unknown"
}, null, 2)}\n`);
console.log(`Sanitized ${candidates.length} evidence files into ${normalize(path.relative(root, output))}.`);
