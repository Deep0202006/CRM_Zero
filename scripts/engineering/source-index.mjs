import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import ts from "typescript";
import { dirtyFingerprint, git, parseArgs, root, sha256 } from "./kernel-lib.mjs";

const parseable = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".md", ".json", ".yml", ".yaml", ".toml"]);
const sourceLike = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const testPath = (path) => /(?:^|\/)(?:__tests__|e2e)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(path);
const language = (path) => ({ ".ts":"typescript", ".tsx":"typescriptreact", ".js":"javascript", ".jsx":"javascriptreact", ".mjs":"javascript", ".cjs":"javascript", ".sql":"sql", ".md":"markdown", ".json":"json", ".yml":"yaml", ".yaml":"yaml", ".toml":"toml" }[extname(path).toLowerCase()] ?? "other");
const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : null;
const lineRange = (source, node) => ({ startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1 });
const unresolvedImportTarget = (path, value) => value?.startsWith("@/") ? `src/${value.slice(2)}` : value?.startsWith(".") ? relative(root, resolve(root, dirname(path), value)).replaceAll("\\", "/") : value;
const routePath = (path) => { const match = /^src\/app\/(.+)\/(?:page|route)\.(?:ts|tsx|js|jsx)$/.exec(path); return match ? `/${match[1]}` : null; };
const emptyRecord = () => ({ exports: [], symbols: [], imports: [], calls: [], calledBy: [], tables: [], rpcs: [], routes: [], fetches: [], sqlIdentifiers: [], sqlReads: [], sqlWrites: [], sqlFunctions: [], sqlPolicies: [], sqlGrants: [], headings: [], references: [] });
const unique = (values) => [...new Set(values.filter(Boolean))];

const parseText = (path, text) => {
  const record = emptyRecord(), extension = extname(path).toLowerCase(), lineAt = (offset) => text.slice(0, offset).split("\n").length;
  if (extension === ".md") record.headings = [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({ name: match[2].trim(), startLine: lineAt(match.index), endLine: lineAt(match.index), level: match[1].length }));
  else if (extension === ".sql") {
    const rows = (regex, kind) => [...text.matchAll(regex)].map((match) => ({ name: match[1], kind, startLine: lineAt(match.index), endLine: lineAt(match.index) }));
    record.sqlFunctions = rows(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?["']?([A-Za-z_][\w]*)/gi, "function");
    record.sqlReads = rows(/\b(?:FROM|JOIN)\s+(?:public\.)?["']?([A-Za-z_][\w]*)/gi, "read");
    record.sqlWrites = rows(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|ALTER\s+TABLE)\s+(?:public\.)?["']?([A-Za-z_][\w]*)/gi, "write");
    record.sqlPolicies = rows(/\bCREATE\s+POLICY\s+["']?([A-Za-z_][\w]*)/gi, "policy");
    record.sqlGrants = rows(/\bGRANT\s+[^;]+\s+ON\s+(?:TABLE\s+)?(?:public\.)?["']?([A-Za-z_][\w]*)/gi, "grant");
    record.sqlIdentifiers = unique([...record.sqlFunctions, ...record.sqlReads, ...record.sqlWrites, ...record.sqlPolicies, ...record.sqlGrants].map((item) => item.name));
  } else if (sourceLike.has(extension)) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS), enclosing = [];
    const visit = (node) => {
      let pushed = false; const declarationName = (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) && node.name?.text;
      if (declarationName) { record.symbols.push({ name: declarationName, kind: ts.SyntaxKind[node.kind], ...lineRange(source, node) }); enclosing.push(declarationName); pushed = true; }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) record.symbols.push({ name: node.name.text, kind: "VariableFunction", ...lineRange(source, node) });
      if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier)) record.imports.push(unresolvedImportTarget(path, literal(node.moduleSpecifier)));
      if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) { if (node.name?.text) record.exports.push(node.name.text); if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) record.exports.push(declaration.name.text); }
      if (ts.isCallExpression(node)) {
        const expression = node.expression, first = literal(node.arguments[0]), range = lineRange(source, node), called = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
        if (called) record.calls.push({ name: called, caller: enclosing.at(-1) ?? "<module>", ...range });
        if (ts.isPropertyAccessExpression(expression) && first) { if (expression.name.text === "from") record.tables.push(first); if (expression.name.text === "rpc") record.rpcs.push(first); }
        if (ts.isIdentifier(expression) && expression.text === "fetch" && first) record.fetches.push({ route: first, ...range });
      }
      ts.forEachChild(node, visit); if (pushed) enclosing.pop();
    };
    visit(source); record.routes = unique([routePath(path), ...record.fetches.map((item) => item.route)]);
  }
  record.exports = unique(record.exports); record.imports = unique(record.imports); record.tables = unique(record.tables); record.rpcs = unique(record.rpcs);
  if (/^(?:docs\/engineering\/|docs\/contracts\/)/.test(path)) record.references = unique([...text.matchAll(/\b(?:authority|capability|proof|domain)(?:Refs?)?\s*[":=]\s*["']?([A-Za-z0-9_-]+)/gi)].map((match) => match[1]));
  if (path === "package.json") try { const value = JSON.parse(text); record.references = unique(Object.entries(value.scripts ?? {}).flatMap(([name, command]) => [name, ...[...String(command).matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)].map((match) => match[1])])); } catch { /* fail closed at consumers; malformed package JSON is validated elsewhere */ }
  if (/^\.github\/workflows\/.+\.ya?ml$/.test(path)) record.references = unique([...text.matchAll(/(?:uses:\s*([^\s#]+)|npm\s+run\s+([A-Za-z0-9:_-]+)|node\s+([^\s#]+))/g)].map((match) => match[1] ?? match[2] ?? match[3]));
  return record;
};

const trackedManifest = () => {
  const rows = execFileSync("git", ["ls-files", "-s", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 32 << 20 }).split("\0").filter(Boolean), changedBy = new Map();
  const log = execFileSync("git", ["log", "--format=@@%H", "--name-only", "--no-renames", "HEAD"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }); let commit = "";
  for (const line of log.split(/\r?\n/)) if (line.startsWith("@@")) commit = line.slice(2); else if (line && commit && !changedBy.has(line)) changedBy.set(line, commit);
  return rows.map((row) => { const match = /^(\d+) ([0-9a-f]{40}) (\d)\t([\s\S]+)$/.exec(row); if (!match) throw new Error("INDEX_GIT_MANIFEST_INVALID"); return { path: match[4].replaceAll("\\", "/"), gitBlobSha: match[2], lastChangedCommit: changedBy.get(match[4]) ?? git("rev-parse", "HEAD") }; });
};
const resolveTrackedImport = (target, paths) => !target || !/^(?:src|e2e|scripts)\//.test(target) ? null : [target, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql"].map((x) => `${target}${x}`), ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].map((x) => `${target}/index${x}`)].find((candidate) => paths.has(candidate)) ?? null;
const atomicJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}`; writeFileSync(temporary, `${JSON.stringify(value)}\n`); renameSync(temporary, path); };

export const indexIdentity = () => ({ headSha: git("rev-parse", "HEAD"), treeSha: git("rev-parse", "HEAD^{tree}"), dirtyFingerprint: dirtyFingerprint() });
export const buildSourceIndex = ({ writeCache = true, includePaths = [] } = {}) => {
  const startedAt = Date.now(), identity = indexIdentity(), baseDirectory = resolve(root, git("rev-parse", "--git-path", `zd-os/index/${identity.treeSha}`)), manifest = trackedManifest(), files = [];
  for (const entry of manifest) {
    const absolute = resolve(root, entry.path); if (!existsSync(absolute)) continue; const buffer = readFileSync(absolute), text = buffer.toString("utf8"), extension = extname(entry.path).toLowerCase(), contentHash = sha256(buffer), blobCache = resolve(baseDirectory, "blobs", `${entry.gitBlobSha}-${contentHash}.json`); let parsed = emptyRecord();
    if (parseable.has(extension)) try { if (existsSync(blobCache)) parsed = JSON.parse(readFileSync(blobCache, "utf8")); else { parsed = parseText(entry.path, text); if (writeCache) atomicJson(blobCache, parsed); } } catch { parsed = parseText(entry.path, text); }
    files.push({ ...entry, contentHash, byteSize: buffer.byteLength, lineCount: text.length ? text.split(/\r?\n/).length : 0, language: language(entry.path), isTest: testPath(entry.path), ...parsed });
  }
  for (const requested of includePaths) if (!files.some((file) => file.path === requested) && existsSync(resolve(root, requested))) { const buffer = readFileSync(resolve(root, requested)); files.push({ path: requested, gitBlobSha: null, lastChangedCommit: identity.headSha, contentHash: sha256(buffer), byteSize: buffer.byteLength, lineCount: buffer.toString("utf8").split(/\r?\n/).length, language: language(requested), isTest: testPath(requested), ...parseText(requested, buffer.toString("utf8")) }); }
  const paths = new Set(files.map((file) => file.path)), reverse = new Map(), byPath = new Map(files.map((file) => [file.path, file]));
  for (const file of files) { file.externalImports = file.imports.filter((target) => !resolveTrackedImport(target, paths)); file.imports = unique(file.imports.map((target) => resolveTrackedImport(target, paths))); for (const target of file.imports) reverse.set(target, [...(reverse.get(target) ?? []), file.path]); }
  const symbolOwners = new Map(); for (const file of files) for (const symbol of file.symbols) symbolOwners.set(symbol.name, [...(symbolOwners.get(symbol.name) ?? []), file]); const edges = [];
  for (const file of files) {
    file.reverseImports = unique(reverse.get(file.path) ?? []); file.relatedTests = file.isTest ? [] : file.reverseImports.filter((path) => byPath.get(path)?.isTest); file.testedSources = file.isTest ? file.imports.filter((path) => !byPath.get(path)?.isTest) : [];
    for (const target of file.imports) edges.push({ from: file.path, to: target, currentPath: file.path, currentHash: file.contentHash, reason: "IMPORT", evidenceType: "EXTRACTED" });
    for (const call of file.calls) for (const owner of symbolOwners.get(call.name) ?? []) { edges.push({ from: file.path, to: owner.path, symbol: call.name, currentPath: file.path, currentHash: file.contentHash, startLine: call.startLine, endLine: call.endLine, reason: "CALL", evidenceType: "INFERRED" }); owner.calledBy.push({ path: file.path, symbol: call.name, startLine: call.startLine, endLine: call.endLine }); }
    for (const test of file.relatedTests) edges.push({ from: test, to: file.path, currentPath: test, currentHash: byPath.get(test)?.contentHash, reason: "RELATED_TEST", evidenceType: "INFERRED" });
  }
  const index = { schemaVersion: 5, ...identity, dirtyOverlay: identity.dirtyFingerprint !== sha256(""), generatedAt: new Date().toISOString(), buildMs: Date.now() - startedAt, manifest, files, edges };
  if (writeCache) { atomicJson(resolve(baseDirectory, "manifest.json"), { schemaVersion: 1, ...identity, files: files.map(({ path, gitBlobSha, contentHash, byteSize, lineCount, language, lastChangedCommit, isTest }) => ({ path, gitBlobSha, contentHash, byteSize, lineCount, language, lastChangedCommit, isTest })) }); atomicJson(resolve(baseDirectory, `index-${identity.dirtyFingerprint}.json`), index); }
  return index;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) { const index = buildSourceIndex({ writeCache: !parseArgs().has("--no-cache") }); console.log(JSON.stringify({ schemaVersion: index.schemaVersion, headSha: index.headSha, treeSha: index.treeSha, dirtyFingerprint: index.dirtyFingerprint, dirtyOverlay: index.dirtyOverlay, fileCount: index.files.length, symbolCount: index.files.reduce((n, f) => n + f.symbols.length, 0), edgeCount: index.edges.length, buildMs: index.buildMs }, null, 2)); }
