import fs from "node:fs";
import path from "node:path";
import { listFiles, readJson, root, sha256 } from "./cli.mjs";

const lock = readJson("harness/migrations.lock.json");
const files = listFiles("supabase/migrations").filter((file) => file.endsWith(".sql")).sort();
const failures = [];
for (const [file, expected] of Object.entries(lock.migrations)) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) failures.push(`Locked migration missing: ${file}`);
  else if (sha256(absolute) !== expected) failures.push(`Locked migration modified: ${file}`);
}
const names = files.map((file) => path.basename(file));
if (names.join("\n") !== [...names].sort().join("\n")) failures.push("Migration names are not monotonic.");
for (const file of files.filter((item) => !lock.migrations[item])) {
  const sql = fs.readFileSync(path.join(root, file), "utf8");
  if (/\b(?:TRUNCATE|DROP\s+TABLE)\b/i.test(sql)) failures.push(`Destructive statement in new migration: ${file}`);
  if (/SECURITY\s+DEFINER/i.test(sql) && !/SET\s+search_path\s*=/i.test(sql)) failures.push(`SECURITY DEFINER lacks fixed search_path: ${file}`);
  if (/COALESCE\s*\(\s*(?:NEW\.)?(?:status|problem_status|outcome)\s*,\s*''/i.test(sql)) failures.push(`Enum-unsafe comparison: ${file}`);
}
if (failures.length) { console.error(failures.map((item) => `- ${item}`).join("\n")); process.exit(1); }
console.log(`Migration lock passed (${files.length} locked migrations).`);
