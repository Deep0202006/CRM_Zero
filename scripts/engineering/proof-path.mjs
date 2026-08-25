import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveProofPath(root, base, head, path) {
  if (existsSync(resolve(root, path))) return { path, repaired: false };
  let blob;
  try {
    blob = execFileSync("git", ["rev-parse", `${base}:${path}`], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    throw new Error(`PROOF_PATH_STALE:${path}`);
  }
  const matches = execFileSync("git", ["ls-tree", "-r", head], {
    cwd: root,
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.split(/\s+/)[2] === blob)
    .map((line) => line.slice(line.indexOf("\t") + 1));
  if (matches.length !== 1) throw new Error(`PROOF_PATH_STALE:${path}`);
  return { path: matches[0], repaired: true, previousPath: path, blob };
}
