import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { dirtyFingerprint } from "./hooks/state.mjs";
const root = resolve(import.meta.dirname, "../.."),
  args = process.argv.slice(2),
  value = (flag) => {
    const i = args.indexOf(flag);
    return i < 0 ? undefined : args[i + 1];
  },
  git = (...a) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const headStatus = Number(value("--head-status") ?? 0),
  baseStatus = Number(value("--base-status") ?? 0),
  classification =
    headStatus === 0
      ? "PASS"
      : baseStatus === 0
        ? "HEAD_REGRESSION"
        : "BASELINE_FAILURE",
  headSha = git("rev-parse", value("--head") ?? "HEAD"),
  baseSha = git("rev-parse", value("--base") ?? "origin/main"),
  treeSha = git("rev-parse", `${value("--head") ?? "HEAD"}^{tree}`),
  dirty = dirtyFingerprint();
console.log(
  JSON.stringify({
    baseSha,
    headSha,
    treeSha,
    dirtyFingerprint: dirty,
    classification,
  }),
);
