import fs from "node:fs";
import path from "node:path";
import { listFiles, root, sha256 } from "./cli.mjs";

const migrations = Object.fromEntries(
  listFiles("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => [file, sha256(path.join(root, file))])
);
fs.writeFileSync(path.join(root, "harness", "migrations.lock.json"), `${JSON.stringify({
  version: 1,
  baselineCommit: process.env.HARNESS_BASE_COMMIT ?? "0b6d1a4",
  migrations
}, null, 2)}\n`);
console.log(`Locked ${Object.keys(migrations).length} migrations.`);
