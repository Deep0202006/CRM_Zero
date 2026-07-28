import fs from "node:fs";
import path from "node:path";
import { listFiles, root } from "./cli.mjs";

const directories = [...new Set(listFiles("docs").filter((file) => /manual-supabase\/02_APPLY\.sql$/.test(file)).map((file) => path.dirname(file)))];
const failures = [];
for (const directory of directories) {
  const apply = path.join(root, directory, "02_APPLY.sql");
  const migration = listFiles("supabase/migrations").filter((file) =>
    file.endsWith(".sql") && fs.readFileSync(apply).equals(fs.readFileSync(path.join(root, file)))
  )[0];
  if (!migration) failures.push(`${directory}: apply SQL differs from every migration`);
  for (const name of ["01_PRECHECK_READ_ONLY.sql", "03_VERIFY_SINGLE_RESULT.sql", "04_RECONCILE_COUNTS.sql"]) {
    const file = path.join(root, directory, name);
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    if (/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(sql.replace(/--.*$/gm, ""))) failures.push(`${directory}/${name}: read-only script contains a write`);
    if (fs.readFileSync(file).equals(fs.readFileSync(apply))) failures.push(`${directory}/${name}: identical to apply SQL`);
  }
}
if (failures.length) { console.error(failures.map((item) => `- ${item}`).join("\n")); process.exit(1); }
console.log(`Manual SQL consistency passed (${directories.length} package).`);
