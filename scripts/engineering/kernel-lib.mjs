import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).trim();
export const run = (file, args, options = {}) => {
  const windowsNodeCli = process.platform === "win32" && ["npm", "npx"].includes(file) ? resolve(dirname(process.execPath), "node_modules/npm/bin", `${file}-cli.js`) : null;
  return spawnSync(windowsNodeCli ? process.execPath : file, windowsNodeCli ? [windowsNodeCli, ...args] : args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.inherit ? "inherit" : "pipe",
    maxBuffer: 64 << 20,
  });
};
export const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8"));
export const parseArgs = (args = process.argv.slice(2)) => ({
  has: (flag) => args.includes(flag),
  value: (flag, fallback) => {
    const index = args.indexOf(flag);
    return index < 0 ? fallback : args[index + 1];
  },
});
export const dirtyFingerprint = (cwd = root) => {
  const status = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd });
  const digest = createHash("sha256").update(status);
  const entries = status.toString("utf8").split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index], path = entry.slice(3);
    const absolute = resolve(cwd, path);
    if (existsSync(absolute)) digest.update(readFileSync(absolute));
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
  }
  return digest.digest("hex");
};
export const repositoryIdentity = (cwd = root, base = "origin/main") => ({
  headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
  treeSha: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd, encoding: "utf8" }).trim(),
  baseSha: execFileSync("git", ["rev-parse", base], { cwd, encoding: "utf8" }).trim(),
  dirtyFingerprint: dirtyFingerprint(cwd),
});
export const safeEnvironment = (source = process.env) => {
  const blocked = /^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|DATABASE_URL|POSTGRES_URL.*|PRODUCTION_.*|VERCEL_TOKEN|AWS_SECRET_ACCESS_KEY|AZURE_.*|CLOUDFLARE_API_TOKEN)$/i;
  const safe = Object.fromEntries(Object.entries(source).filter(([key]) => !blocked.test(key)));
  if (source.NEXT_PUBLIC_SUPABASE_URL === "https://e2e.supabase.co") safe.NEXT_PUBLIC_SUPABASE_URL = source.NEXT_PUBLIC_SUPABASE_URL;
  if (source.NEXT_PUBLIC_SUPABASE_ANON_KEY === "e2e-anon-key") safe.NEXT_PUBLIC_SUPABASE_ANON_KEY = source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return safe;
};
export const environmentPolicyHash = () =>
  sha256(JSON.stringify({ inherit: "core", network: false, excluded: ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DATABASE_URL", "POSTGRES_URL*", "PRODUCTION_*", "VERCEL_TOKEN", "AWS_SECRET_ACCESS_KEY", "AZURE_*", "CLOUDFLARE_API_TOKEN"] }));
