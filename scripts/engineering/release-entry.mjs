import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { engineeringTempRoot } from "./managed-paths.mjs";

export const releaseEnvironment = (source = process.env) => {
  const temporary = engineeringTempRoot("release");
  mkdirSync(temporary, { recursive: true });
  return { ...source, TEMP: temporary, TMP: temporary, TMPDIR: temporary };
};

export const runRelease = (args = process.argv.slice(2)) => spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, "release-controller.mjs"), ...args],
  { cwd: resolve(import.meta.dirname, "../.."), env: releaseEnvironment(), stdio: "inherit", shell: false },
).status ?? 2;

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exitCode = runRelease();
