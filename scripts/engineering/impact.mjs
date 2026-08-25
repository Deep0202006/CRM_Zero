import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../.."),
  args = process.argv.slice(2),
  value = (k) => {
    const i = args.indexOf(k);
    return i < 0 ? undefined : args[i + 1];
  },
  base = value("--base") ?? "origin/main",
  head = value("--head") ?? "HEAD",
  git = (...a) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const fixturePaths = process.env.ZEROGRAPH_IMPACT_PATHS,
  paths = fixturePaths
    ? JSON.parse(fixturePaths)
    : git("diff", "--name-only", `${base}...${head}`)
        .split(/\r?\n/)
        .filter(Boolean),
  patch = fixturePaths
    ? (process.env.ZEROGRAPH_IMPACT_PATCH ?? "")
    : git("diff", "--unified=0", `${base}...${head}`),
  map = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/DOMAIN_MAP.json")),
  ).domains;
const domains = new Set(),
  effects = new Set();
const patternMatch = (path, pattern) =>
  pattern.endsWith("/**")
    ? path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -2))
    : path === pattern;
for (const path of paths) {
  for (const d of map)
    if (
      [
        ...(d.surfacePaths ?? []),
        ...(d.codeRoots ?? []),
        ...(d.serverBoundaries ?? []),
        ...(d.contractPaths ?? []),
        ...(d.criticalTests ?? []),
      ].some(
        (p) =>
          path === p || path.startsWith(`${p}/`) || p.startsWith(`${path}/`),
      ) ||
      (d.pathPatterns ?? []).some((p) => patternMatch(path, p))
    )
      domains.add(d.id);
  if (/^supabase\/migrations\/\d+_.*\.sql$/.test(path)) effects.add("DATABASE");
  if (/^docs\/handover\/|^scripts\/handover\/|^\.handover\//.test(path)) {
    effects.add("PLATFORM");
    effects.add("CONFIGURATION");
    domains.add("platform-handover");
    if (/^scripts\/handover\//.test(path)) {
      effects.add("DATABASE");
      effects.add("AUTHORIZATION");
      effects.add("SECURITY");
      effects.add("STORAGE");
      effects.add("REALTIME");
    }
  }
  if (path.startsWith("src/app/api/")) effects.add("API");
  if (path.startsWith("src/app/") || path.startsWith("src/components/"))
    effects.add("UI");
  if (path === "src/lib/db.ts" || /sync|outbox/i.test(path))
    effects.add("OFFLINE");
  if (/import|spreadsheet/i.test(path)) effects.add("IMPORT");
  if (/analytics|kpi/i.test(path)) effects.add("ANALYTICS");
  if (/export|excel/i.test(path)) effects.add("EXPORT");
  if (
    /^(scripts\/engineering|scripts\/quality|docs\/engineering|\.github|\.codex|AGENTS\.md)/.test(
      path,
    )
  ) {
    effects.add("ENGINEERING_CONTROL");
    domains.add("engineering-control");
  }
}
const sqlPaths = paths.filter((path) => path.endsWith(".sql")),
  sqlPatch = sqlPaths.length
    ? fixturePaths
      ? patch
      : execFileSync(
          "git",
          ["diff", "--unified=0", `${base}...${head}`, "--", ...sqlPaths],
          { cwd: root, encoding: "utf8" },
        )
    : "";
if (
  /CREATE POLICY|DROP POLICY|ROW LEVEL SECURITY|SECURITY DEFINER|auth\.uid\(|GRANT|REVOKE/i.test(
    sqlPatch,
  )
) {
  effects.add("AUTHORIZATION");
  effects.add("SECURITY");
}
const risk = [
  "DATABASE",
  "AUTHORIZATION",
  "SECURITY",
  "ENGINEERING_CONTROL",
].some((x) => effects.has(x))
  ? "R3"
  : effects.size
    ? "R2"
    : "R0";
const graphifyRecommended =
  domains.size > 1 && paths.some((path) => path === "src/lib/db.ts");
console.log(
  JSON.stringify(
    {
      baseSha: git("rev-parse", base),
      headSha: git("rev-parse", head),
      changedPaths: paths,
      domains: [...domains].sort(),
      effects: [...effects].sort(),
      risk,
      graphifyRecommended,
      impactHash: createHash("sha256").update(patch).digest("hex"),
    },
    null,
    2,
  ),
);
