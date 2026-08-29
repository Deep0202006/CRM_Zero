import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";
import { dirtyFingerprint, git, parseArgs, root, sha256 } from "./kernel-lib.mjs";

const included = /^(?:src|e2e|scripts|docs\/contracts|docs\/engineering)\//;
const excluded = /(?:^|\/)(?:node_modules|archives?|generated|graphify-out)(?:\/|$)|^docs\/engineering\/(?:LEGACY_|OS_)/i;
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"]);
const testPath = (path) => /(?:^|\/)(?:__tests__|e2e)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(path);
const trackedPaths = (includePaths = []) => execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter((path) => path && ((included.test(path) && !excluded.test(path)) || includePaths.includes(path)));
const registryPaths = ["docs/engineering/AUTHORITIES.json", "docs/engineering/CAPABILITIES.json", "docs/engineering/DOMAIN_MAP.json", "docs/engineering/PROOFS.json", "docs/engineering/CLAIMS.json", "docs/engineering/LESSONS.json"];
const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : null;
const unresolvedImportTarget = (path, value) => value?.startsWith("@/") ? `src/${value.slice(2)}` : value?.startsWith(".") ? relative(root, resolve(root, dirname(path), value)).replaceAll("\\", "/") : value;
const routePath = (path) => {
  const match = /^src\/app\/(.+)\/(?:page|route)\.(?:ts|tsx|js|jsx)$/.exec(path);
  return match ? `/${match[1].replace(/\/(?:route|page)$/, "")}` : null;
};
const parseSource = (path, text) => {
  const record = { exports: [], imports: [], tables: [], rpcs: [], routes: [], sqlIdentifiers: [] };
  if (path.endsWith(".sql")) {
    record.sqlIdentifiers = [...text.matchAll(/\b(?:TABLE|FUNCTION|POLICY)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:public\.)?["']?([a-zA-Z_][\w]*)/gi)].map((match) => match[1]);
    return record;
  }
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.tsx?$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)) record.imports.push(unresolvedImportTarget(path, literal(node.moduleSpecifier)));
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node)) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (node.name?.text) record.exports.push(node.name.text);
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) record.exports.push(declaration.name.text);
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression, first = literal(node.arguments[0]);
      if (ts.isPropertyAccessExpression(expression) && first) {
        if (expression.name.text === "from") record.tables.push(first);
        if (expression.name.text === "rpc") record.rpcs.push(first);
      }
      if (ts.isIdentifier(expression) && expression.text === "fetch" && first) record.routes.push(first);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const ownRoute = routePath(path);
  if (ownRoute) record.routes.push(ownRoute);
  return record;
};
const resolveTrackedImport = (target, paths) => {
  if (!target || !target.startsWith("src/") && !target.startsWith("e2e/") && !target.startsWith("scripts/")) return null;
  const candidates = [target, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"].map((extension) => `${target}${extension}`), ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${target}/index${extension}`)];
  return candidates.find((candidate) => paths.has(candidate)) ?? null;
};
export const indexIdentity = () => ({
  headSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}"), dirtyFingerprint: dirtyFingerprint(),
  registryHash: sha256(registryPaths.map((path) => `${path}:${sha256(readFileSync(resolve(root, path)))}`).join("\n")),
});
export const buildSourceIndex = ({ writeCache = true, includePaths = [] } = {}) => {
  const identity = indexIdentity(), files = [];
  for (const path of trackedPaths(includePaths)) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, "utf8"), extension = extname(path).toLowerCase();
    files.push({ path, contentHash: sha256(text), isTest: testPath(path), ...(sourceExtensions.has(extension) ? parseSource(path, text) : { exports: [], imports: [], tables: [], rpcs: [], routes: [], sqlIdentifiers: [] }) });
  }
  const paths = new Set(files.map((file) => file.path)), reverse = new Map();
  for (const file of files) {
    file.externalImports = file.imports.filter((target) => !resolveTrackedImport(target, paths));
    file.imports = [...new Set(file.imports.map((target) => resolveTrackedImport(target, paths)).filter(Boolean))];
    for (const target of file.imports) reverse.set(target, [...(reverse.get(target) ?? []), file.path]);
  }
  for (const file of files) {
    file.reverseImports = [...new Set(reverse.get(file.path) ?? [])];
    file.relatedTests = file.isTest ? [] : file.reverseImports.filter((path) => files.find((candidate) => candidate.path === path)?.isTest);
    file.testedSources = file.isTest ? file.imports.filter((path) => !files.find((candidate) => candidate.path === path)?.isTest) : [];
  }
  const index = { schemaVersion: 2, ...identity, files };
  if (writeCache) {
    const path = resolve(root, git("rev-parse", "--git-path", `zd-kernel/source-index/${sha256(JSON.stringify(identity))}.json`));
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(index)}\n`);
    renameSync(temp, path);
  }
  return index;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const index = buildSourceIndex({ writeCache: !parseArgs().has("--no-cache") });
  console.log(JSON.stringify({ ...Object.fromEntries(Object.entries(index).filter(([key]) => key !== "files")), fileCount: index.files.length }, null, 2));
}
