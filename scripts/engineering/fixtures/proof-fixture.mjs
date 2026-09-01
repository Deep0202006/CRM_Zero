import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { git, root } from "../kernel-lib.mjs";
const mode = process.argv[2], marker = resolve(root, git("rev-parse", "--git-path", "zd-kernel/fixtures/flaky-marker"));
if (mode === "pass") process.exit(0);
if (mode === "flaky") {
  mkdirSync(dirname(marker), { recursive: true });
  if (!existsSync(marker)) { writeFileSync(marker, "first-attempt\n"); process.stdout.write("progress ".repeat(400)); console.error("first attempt fails"); process.exit(1); }
  process.exit(0);
}
process.exit(2);
