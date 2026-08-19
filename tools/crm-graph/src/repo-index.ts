import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const EXCLUDED = new Set([
  "node_modules",".next",".git",".archive",".worktrees","test-results",
  "playwright-report",".codex-artifacts","scratch"
]);

function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|sql|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

export function buildRepoIndex(root: string) {
  const files = walk(root);
  const nodes: any[] = [];
  const edges: any[] = [];

  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g,"/");
    const text = fs.readFileSync(file, "utf8");
    nodes.push({ id:`file:${rel}`, type:"file", path:rel });

    if (/\.(ts|tsx|js|jsx)$/.test(file)) {
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
          edges.push({ from:`file:${rel}`, type:"imports", to:st.moduleSpecifier.text });
        }
        const name = (st as any).name?.text;
        if (name && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st))) {
          nodes.push({ id:`symbol:${rel}:${name}`, type:"symbol", name, file:rel });
          edges.push({ from:`file:${rel}`, type:"defines", to:`symbol:${rel}:${name}` });
        }
      }
    }

    if (file.endsWith(".sql")) {
      for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_.]+)/ig)) {
        nodes.push({ id:`sqlfn:${m[1]}`, type:"sql-function", name:m[1], file:rel });
        edges.push({ from:`file:${rel}`, type:"defines", to:`sqlfn:${m[1]}` });
      }
      for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_.]+)/ig)) {
        nodes.push({ id:`table:${m[1]}`, type:"table", name:m[1], file:rel });
        edges.push({ from:`file:${rel}`, type:"defines", to:`table:${m[1]}` });
      }
    }
  }

  return { schemaVersion:1, generatedAt:new Date().toISOString(), nodes, edges };
}
