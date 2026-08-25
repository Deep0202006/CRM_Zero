import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
export const root = resolve(import.meta.dirname, "../../..");
export const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
export const sha = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
export const readInput = async () => {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return JSON.parse(raw || "{}");
};
export const sessionPath = (sessionId = "unknown") =>
  resolve(
    root,
    git(
      "rev-parse",
      "--git-path",
      `zerograph/sessions/${String(sessionId).replace(/[^a-zA-Z0-9._-]/g, "_")}.json`,
    ),
  );
export const loadState = (sessionId) => {
  const path = sessionPath(sessionId);
  return existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { session_id: sessionId, stallCount: 0 };
};
export const saveState = (state) => {
  const path = sessionPath(state.session_id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
};
export const dirtyFingerprint = () =>
  (() => {
    const status = execFileSync(
        "git",
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        { cwd: root },
      ),
      digest = createHash("sha256").update(status);
    for (const entry of status.toString("utf8").split("\0").filter(Boolean)) {
      const path = entry.slice(3);
      if (existsSync(resolve(root, path)))
        digest.update(readFileSync(resolve(root, path)));
    }
    return digest.digest("hex");
  })();
export const repositoryState = () => ({
  currentHeadSha: git("rev-parse", "HEAD"),
  currentTreeSha: git("rev-parse", "HEAD^{tree}"),
  currentDirtyFingerprint: dirtyFingerprint(),
});
