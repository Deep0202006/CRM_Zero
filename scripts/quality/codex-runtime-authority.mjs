import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryRoot } from "../engineering/managed-paths.mjs";

const ownerRuntimeKeys = new Set(["approval_policy", "approvals_reviewer", "sandbox_mode", "model", "model_reasoning_effort", "network_access"]);
export const prohibitedRuntimeSettings = (text) => {
  let section = "";
  return String(text).split(/\r?\n/).flatMap((raw) => {
    const line = raw.replace(/#.*$/, "").trim(), header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1]; return []; }
    const setting = /^([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
    return setting && (ownerRuntimeKeys.has(setting) || section === "sandbox_workspace_write") ? [`${section ? `${section}.` : ""}${setting}`] : [];
  });
};

export const assertCodexRuntimeAuthority = (root = repositoryRoot()) => {
  const path = resolve(root, ".codex", "config.toml"), prohibited = prohibitedRuntimeSettings(readFileSync(path, "utf8"));
  if (prohibited.length) throw new Error(`CODEX_RUNTIME_AUTHORITY_VIOLATION:${prohibited.join(",")}`);
  return { code: "CODEX_RUNTIME_AUTHORITY_PASS", path };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) console.log(JSON.stringify(assertCodexRuntimeAuthority()));
