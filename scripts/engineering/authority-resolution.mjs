import { createHash } from "node:crypto";
import ts from "typescript";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const qualified = (value, defaultSchema = "public") => {
  const parts = String(value ?? "").replaceAll('"', "").split(".").filter(Boolean);
  return parts.length > 1 ? { schema: parts.at(-2), resource: parts.at(-1) } : { schema: defaultSchema, resource: parts[0] ?? null };
};
const literal = (node) => node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const operationIdentity = (item) => sha256(JSON.stringify([item.operationKind, item.schema, item.resource, item.targetKnown, [...item.writtenColumns].sort(), item.columnsKnown, item.functionName, item.enclosingFunction, item.isDml, item.schemaChanging, item.wholeResourceMutation, item.effect, item.parserEvidence]));
const operation = (sourcePath, sourceContentHash, values) => {
  const item = { sourcePath, sourceContentHash, operationKind: values.operationKind, schema: values.schema ?? null, resource: values.resource ?? null, targetKnown: values.targetKnown ?? Boolean(values.resource || values.functionName), writtenColumns: [...new Set(values.writtenColumns ?? [])], columnsKnown: values.columnsKnown ?? true, functionName: values.functionName ?? null, enclosingFunction: values.enclosingFunction ?? null, isDml: values.isDml ?? false, schemaChanging: values.schemaChanging ?? false, wholeResourceMutation: values.wholeResourceMutation ?? false, effect: values.effect ?? "WRITE", parserEvidence: values.parserEvidence ?? "EXTRACTED" };
  if (values.analysisError) item.analysisError = values.analysisError;
  item.operationIdentity = operationIdentity(item);
  return item;
};
const callArgument = (node, method) => {
  if (!node) return null;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (node.expression.name.text === method) return node.arguments[0] ?? null;
    return callArgument(node.expression.expression, method);
  }
  return ts.isPropertyAccessExpression(node) ? callArgument(node.expression, method) : null;
};
const immutableConsts = (source) => {
  const values = new Map();
  const visit = (node) => {
    if (ts.isVariableStatement(node) && (node.declarationList.flags & ts.NodeFlags.Const)) for (const declaration of node.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.initializer) values.set(declaration.name.text, declaration.initializer);
    ts.forEachChild(node, visit);
  };
  visit(source); return values;
};
const assignedStrings = (source) => {
  const values = new Map(), invalid = new Set(), add = (name, node) => { const value = literal(node); if (value === null) invalid.add(name); else values.set(name, new Set([...(values.get(name) ?? []), value])); };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) add(node.name.text, node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) add(node.left.text, node.right);
    ts.forEachChild(node, visit);
  };
  visit(source); return { values, invalid };
};
const payloadShape = (node, constants, seen = new Set()) => {
  if (!node) return { columns: [], known: false };
  if (ts.isIdentifier(node)) {
    if (!constants.has(node.text) || seen.has(node.text)) return { columns: [], known: false };
    return payloadShape(constants.get(node.text), constants, new Set([...seen, node.text]));
  }
  if (ts.isArrayLiteralExpression(node)) {
    const shapes = node.elements.map((item) => payloadShape(item, constants, seen));
    return { columns: [...new Set(shapes.flatMap((item) => item.columns))], known: shapes.every((item) => item.known) };
  }
  if (!ts.isObjectLiteralExpression(node)) return { columns: [], known: false };
  const columns = [];
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = payloadShape(property.expression, constants, seen); columns.push(...spread.columns);
      if (!spread.known) return { columns: [...new Set(columns)], known: false };
      continue;
    }
    if (!property.name) return { columns: [...new Set(columns)], known: false };
    if (ts.isComputedPropertyName(property.name)) {
      const value = literal(property.name.expression) ?? (ts.isIdentifier(property.name.expression) ? literal(constants.get(property.name.expression.text)) : null);
      if (value === null) return { columns: [...new Set(columns)], known: false };
      columns.push(value);
    } else if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)) columns.push(property.name.text);
    else return { columns: [...new Set(columns)], known: false };
  }
  return { columns: [...new Set(columns)], known: true };
};
const staticString = (node, constants) => {
  const value = literal(node);
  if (value !== null) return value;
  return ts.isIdentifier(node) ? literal(constants.get(node.text)) : null;
};

export const extractSourceOperations = (path, text, { contentHash = sha256(text) } = {}) => {
  if (!/\.(?:c?js|mjs|mts|cts|jsx|tsx?)$/i.test(path) || !text.trim()) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.tsx?$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.JS), constants = immutableConsts(source), assignments = assignedStrings(source), records = [];
  const unknown = (kind, error, values = {}) => records.push(operation(path, contentHash, { operationKind: kind, effect: "UNKNOWN", parserEvidence: "INFERRED", analysisError: error, targetKnown: false, columnsKnown: false, ...values }));
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const kind = node.expression.name.text;
      if (["insert", "upsert", "update", "delete"].includes(kind)) {
        const targetNode = callArgument(node.expression.expression, "from"), target = staticString(targetNode, constants), schemaNode = callArgument(node.expression.expression, "schema"), schemaValue = schemaNode ? staticString(schemaNode, constants) : "public";
        if (target === null || schemaNode && schemaValue === null) unknown(kind, "WRITE_TARGET_UNKNOWN", { isDml: true });
        else {
          const { schema, resource } = qualified(target, schemaValue), shape = kind === "delete" ? { columns: [], known: true } : payloadShape(node.arguments[0], constants);
          records.push(operation(path, contentHash, { operationKind: kind, schema, resource, writtenColumns: shape.columns, columnsKnown: shape.known, isDml: true, wholeResourceMutation: kind === "delete", parserEvidence: "TS_AST", effect: shape.known ? "WRITE" : "UNKNOWN", analysisError: shape.known ? undefined : "WRITE_COLUMNS_UNKNOWN" }));
        }
      } else if (kind === "rpc") {
        const directName = staticString(node.arguments[0], constants), names = directName !== null ? [directName] : ts.isIdentifier(node.arguments[0]) && !assignments.invalid.has(node.arguments[0].text) ? [...(assignments.values.get(node.arguments[0].text) ?? [])] : [];
        if (!names.length) unknown("rpc", "RPC_EFFECT_UNKNOWN", { isDml: true });
        else for (const name of names) {
          const { schema, resource } = qualified(name), shape = payloadShape(node.arguments[1], constants);
          records.push(operation(path, contentHash, { operationKind: "rpc", schema, resource: null, functionName: `${schema}.${resource}`, writtenColumns: shape.columns, columnsKnown: shape.known, isDml: true, effect: "UNKNOWN", parserEvidence: "TS_AST", analysisError: "RPC_EFFECT_UNKNOWN" }));
        }
      } else if (/^(?:createUser|deleteUser|updateUserById|inviteUserByEmail|generateLink|signOut)$/.test(kind) && text.slice(Math.max(0, node.pos - 100), node.end).includes(".auth.admin")) {
        const shape = payloadShape(node.arguments[1] ?? node.arguments[0], constants);
        records.push(operation(path, contentHash, { operationKind: "auth_admin", schema: "auth", resource: "users", functionName: `auth.admin.${kind}`, writtenColumns: shape.columns, columnsKnown: shape.known, isDml: true, effect: shape.known ? "WRITE" : "UNKNOWN", parserEvidence: "TS_AST", analysisError: shape.known ? undefined : "WRITE_COLUMNS_UNKNOWN" }));
      } else if (/^(?:query|execute|executeRaw|queryRaw|unsafeQuery)$/i.test(kind)) {
        const sql = staticString(node.arguments[0], constants);
        if (sql === null) unknown("raw_sql", "DYNAMIC_SQL_EFFECT_UNKNOWN");
        else records.push(...extractSqlOperations(path, sql, { contentHash, parserEvidence: "TS_LITERAL_SQL" }));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (source.parseDiagnostics.length && /\.(?:from\s*\(|rpc\s*\(|insert\s*\(|upsert\s*\(|update\s*\(|delete\s*\(|(?:query|execute)\s*\()/i.test(text)) unknown("unparsed_source_write", "UNPARSED_WRITE_OPERATION");
  return records;
};
export const extractSourceWrites = extractSourceOperations;

const maskSql = (text, maskDollarBodies = true) => {
  let output = "", quote = "", dollar = "", line = false, block = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (line) { output += char === "\n" ? (line = false, "\n") : " "; continue; }
    if (block) { if (char === "*" && next === "/") { output += "  "; block = false; index += 1; } else output += char === "\n" ? "\n" : " "; continue; }
    if (dollar) { if (text.startsWith(dollar, index)) { output += dollar; index += dollar.length - 1; dollar = ""; } else output += maskDollarBodies ? (char === "\n" ? "\n" : " ") : char; continue; }
    if (quote) { output += quote === '"' ? char : (char === "\n" ? "\n" : " "); if (char === quote && next === quote) { output += quote === '"' ? next : " "; index += 1; } else if (char === quote) quote = ""; continue; }
    const tag = text.slice(index).match(/^\$[A-Za-z0-9_]*\$/)?.[0];
    if (tag) { dollar = tag; output += tag; index += tag.length - 1; }
    else if (char === "'" || char === '"') { quote = char; output += quote === '"' ? char : " "; }
    else if (char === "-" && next === "-") { line = true; output += "  "; index += 1; }
    else if (char === "/" && next === "*") { block = true; output += "  "; index += 1; }
    else output += char;
  }
  return output;
};
const sqlFunctions = (sql) => {
  const functions = [];
  for (const match of sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)/gi)) {
    const bodyStart = match.index + match[0].length, bodyEnd = sql.indexOf(match[2], bodyStart);
    if (bodyEnd < 0) continue;
    const { schema, resource } = qualified(match[1]);
    functions.push({ name: `${schema}.${resource}`, header: sql.slice(match.index, bodyStart), body: sql.slice(bodyStart, bodyEnd), start: match.index, end: bodyEnd + match[2].length });
  }
  return functions;
};
const sqlColumns = (value) => [...new Set(String(value ?? "").split(",").map((item) => /^\s*"?([A-Za-z_][\w]*)"?/.exec(item)?.[1]).filter(Boolean))];
const sqlRecord = (path, hash, kind, target, columns, values = {}) => { const { schema, resource } = qualified(target); return operation(path, hash, { operationKind: kind, schema, resource, writtenColumns: columns, parserEvidence: values.parserEvidence ?? "SQL_LEXER", ...values }); };
const parseSqlSegment = (path, sql, hash, { enclosingFunction = null, parserEvidence = "SQL_LEXER" } = {}) => {
  const clean = maskSql(sql), records = [], add = (match, kind, columns, values = {}) => records.push(sqlRecord(path, hash, kind, match[1], columns, { enclosingFunction, parserEvidence, ...values }));
  for (const match of clean.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)([\s\S]*?);/gi)) for (const column of match[2].matchAll(/\b(ADD|DROP|ALTER|RENAME)\s+(?:COLUMN\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([A-Za-z_]\w*)"?/gi)) if (column[2].toLowerCase() !== "constraint") add(match, `alter_table_${column[1].toLowerCase()}_column`, [column[2]], { schemaChanging: true });
  for (const match of clean.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)([\s\S]*?);/gi)) if (/\b(?:ADD|DROP|RENAME)\s+CONSTRAINT\b/i.test(match[2])) {
    const constrained = /\bCHECK\s*\(\s*"?([A-Za-z_]\w*)"?/i.exec(match[2])?.[1]; add(match, "alter_table_constraint", constrained ? [constrained] : [], { schemaChanging: true, columnsKnown: Boolean(constrained), effect: constrained ? "WRITE" : "UNKNOWN", analysisError: constrained ? undefined : "WRITE_COLUMNS_UNKNOWN" });
  }
  for (const match of clean.matchAll(/\bUPDATE\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)\s+SET\s+([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|;|$)/gi)) add(match, "update", [...match[2].matchAll(/(?:^|,)\s*"?([A-Za-z_]\w*)"?\s*=/g)].map((item) => item[1]), { isDml: true, columnsKnown: /=/.test(match[2]) });
  for (const match of clean.matchAll(/\bINSERT\s+INTO\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)\s*(?:\(([^)]*)\))?/gi)) add(match, "insert", sqlColumns(match[2]), { isDml: true, columnsKnown: Boolean(match[2]), effect: match[2] ? "WRITE" : "UNKNOWN", analysisError: match[2] ? undefined : "WRITE_COLUMNS_UNKNOWN" });
  for (const match of clean.matchAll(/\bDELETE\s+FROM\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add(match, "delete", [], { isDml: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\bTRUNCATE(?:\s+TABLE)?\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add(match, "truncate", [], { isDml: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\bMERGE\s+INTO\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add(match, "merge", [], { isDml: true, columnsKnown: false, effect: "UNKNOWN", analysisError: "WRITE_COLUMNS_UNKNOWN" });
  for (const match of clean.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)\s*\(([^;]*)\)\s*;/gi)) add(match, "create_table", sqlColumns(match[2]).filter((column) => !/^(?:constraint|primary|unique|check|foreign)$/i.test(column)), { schemaChanging: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add(match, "drop_table", [], { schemaChanging: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\b(?:CREATE|DROP|ALTER)\s+POLICY\s+"?[A-Za-z_]\w*"?[\s\S]*?\bON\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add(match, "policy_change", [], { schemaChanging: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\bALTER\s+TABLE\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)\s+(?:ENABLE|DISABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi)) add(match, "rls_change", [], { schemaChanging: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\bCREATE\s+TRIGGER\s+"?[A-Za-z_]\w*"?[\s\S]*?\bON\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add(match, "create_trigger", [], { schemaChanging: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\b(GRANT|REVOKE)\b[\s\S]*?\bON\s+(?!FUNCTION\b)(?:TABLE\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) add({ 1: match[2] }, `${match[1].toLowerCase()}_privilege`, [], { schemaChanging: true, wholeResourceMutation: true });
  for (const match of clean.matchAll(/\b(GRANT|REVOKE)\s+EXECUTE\s+ON\s+FUNCTION\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) { const target = qualified(match[2]); records.push(operation(path, hash, { operationKind: `${match[1].toLowerCase()}_function`, schema: target.schema, functionName: `${target.schema}.${target.resource}`, schemaChanging: true, effect: "WRITE", parserEvidence })); }
  if (enclosingFunction && /\bEXECUTE\b/i.test(clean)) records.push(operation(path, hash, { operationKind: "dynamic_sql", enclosingFunction, effect: "UNKNOWN", targetKnown: false, columnsKnown: false, parserEvidence, analysisError: "DYNAMIC_SQL_EFFECT_UNKNOWN" }));
  return records;
};

export const extractSqlOperations = (path, sql, { contentHash = sha256(sql), parserEvidence = "SQL_LEXER", catalogue } = {}) => {
  if ((!/\.sql$/i.test(path) && parserEvidence !== "TS_LITERAL_SQL") || !sql.trim()) return [];
  const functions = sqlFunctions(sql), records = parseSqlSegment(path, maskSql(sql), contentHash, { parserEvidence });
  for (const definition of functions) {
    const body = parseSqlSegment(path, definition.body, contentHash, { enclosingFunction: definition.name, parserEvidence: "SQL_FUNCTION_BODY" }); records.push(...body);
    const known = catalogue?.get(definition.name), effect = known?.effect ?? (body.some((item) => item.effect === "UNKNOWN") ? "UNKNOWN" : body.some((item) => item.effect === "WRITE") ? "WRITE" : "READ");
    records.push(operation(path, contentHash, { operationKind: "function_definition", functionName: definition.name, schema: qualified(definition.name).schema, resource: null, schemaChanging: true, effect, parserEvidence: "SQL_FUNCTION_DEFINITION", analysisError: effect === "UNKNOWN" ? "RPC_EFFECT_UNKNOWN" : undefined }));
  }
  for (const match of maskSql(sql).matchAll(/\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)) { const target = qualified(match[1]), functionName = `${target.schema}.${target.resource}`, effect = catalogue?.get(functionName)?.effect ?? "UNKNOWN"; records.push(operation(path, contentHash, { operationKind: "drop_function", schema: target.schema, functionName, schemaChanging: true, effect, parserEvidence, analysisError: effect === "UNKNOWN" ? "RPC_EFFECT_UNKNOWN" : undefined })); }
  if (/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(maskSql(sql)) && !functions.length) records.push(operation(path, contentHash, { operationKind: "unparsed_function_definition", targetKnown: false, columnsKnown: false, schemaChanging: true, effect: "UNKNOWN", parserEvidence, analysisError: "UNPARSED_WRITE_OPERATION" }));
  return records;
};
export const extractSqlWrites = extractSqlOperations;
export const extractSqlReadFunctions = (path, sql) => extractSqlOperations(path, sql).filter((item) => item.operationKind === "function_definition" && item.effect === "READ").map((item) => item.functionName);

export const buildSqlFunctionCatalogue = (files) => {
  const catalogue = new Map();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) for (const definition of sqlFunctions(file.text)) {
    const direct = parseSqlSegment(file.path, definition.body, file.contentHash ?? sha256(file.text), { enclosingFunction: definition.name, parserEvidence: "SQL_FUNCTION_BODY" }), clean = maskSql(definition.body, false);
    const writtenResources = new Set(direct.map((item) => `${item.schema}.${item.resource}`.toLowerCase())), calls = [...new Set([...clean.matchAll(/\b(public\.[A-Za-z_]\w*)\s*\(/gi)].map((match) => { const value = qualified(match[1]); return `${value.schema}.${value.resource}`; }).filter((name) => name !== definition.name && !writtenResources.has(name.toLowerCase())))];
    const reads = [...new Set([...clean.matchAll(/\b(?:FROM|JOIN)\s+((?:"?[A-Za-z_]\w*"?\.)?"?[A-Za-z_]\w*"?)/gi)].map((match) => { const value = qualified(match[1]); return `${value.schema}.${value.resource}`; }))];
    catalogue.set(definition.name, { functionIdentity: definition.name, volatility: /\bIMMUTABLE\b/i.test(definition.header) ? "IMMUTABLE" : /\bSTABLE\b/i.test(definition.header) ? "STABLE" : "VOLATILE", directReads: reads, directWrites: direct.filter((item) => item.effect === "WRITE"), calledFunctions: calls, dynamicSql: direct.some((item) => item.analysisError === "DYNAMIC_SQL_EFFECT_UNKNOWN"), externallyCallable: /\bSECURITY\s+DEFINER\b/i.test(definition.header) || /(?:^|_)command(?:_|$)/i.test(definition.name), effect: "UNKNOWN", effectiveWrites: [], definingSourcePath: file.path, contentHash: file.contentHash ?? sha256(file.text) });
  }
  for (const file of files) for (const name of catalogue.keys()) if (new RegExp(`\\bGRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${name.replace(".", "\\.")}\\b`, "i").test(maskSql(file.text, false))) catalogue.get(name).externallyCallable = true;
  const effectFor = (name, visiting = new Set()) => {
    const item = catalogue.get(name); if (!item || visiting.has(name)) return "UNKNOWN";
    if (item.dynamicSql) return item.effect = "UNKNOWN";
    const effects = item.calledFunctions.map((callee) => catalogue.has(callee) ? effectFor(callee, new Set([...visiting, name])) : "UNKNOWN");
    return item.effect = effects.some((effect) => effect === "UNKNOWN") ? "UNKNOWN" : item.directWrites.length || effects.some((effect) => effect === "WRITE") ? "WRITE" : "READ";
  };
  for (const name of catalogue.keys()) effectFor(name);
  const writesFor = (name, visiting = new Set()) => {
    const item = catalogue.get(name); if (!item || visiting.has(name) || item.effect === "UNKNOWN") return [];
    return [...item.directWrites, ...item.calledFunctions.flatMap((callee) => writesFor(callee, new Set([...visiting, name])))];
  };
  for (const [name, item] of catalogue) item.effectiveWrites = writesFor(name);
  return catalogue;
};

const explicitSelectors = (fact) => (fact.writeSelectors ?? []).flatMap((selector) => {
  const operationKinds = selector.operationKinds ?? (selector.operationKind ? [selector.operationKind] : null);
  if (selector.function || selector.rpc) return [{ fact, specificity: 3, functionName: selector.function ?? selector.rpc, operationKinds, wholeResource: selector.wholeResource === true }];
  const resource = selector.resource ?? selector.table, columns = selector.columns ?? (selector.column ? [selector.column] : []);
  return columns.length ? columns.map((column) => ({ fact, specificity: 2, schema: selector.schema ?? "public", resource, column, operationKinds, wholeResource: false })) : resource ? [{ fact, specificity: 1, schema: selector.schema ?? "public", resource, operationKinds, wholeResource: selector.wholeResource === true }] : [];
});
const legacySelectors = (fact) => {
  if (Object.hasOwn(fact, "writeSelectors")) return [];
  const authority = String(fact.authority ?? ""), selectors = [...authority.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g)].map((match) => ({ fact, specificity: match[3] ? 2 : 1, schema: match[1], resource: match[2], column: match[3] ?? null, operationKinds: null, wholeResource: false }));
  for (const match of authority.matchAll(/\bvia\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)/gi)) selectors.push({ fact, specificity: 3, functionName: `${match[1]}.${match[2]}`, operationKinds: null, wholeResource: false });
  return selectors;
};
const allowsKind = (selector, kind) => !selector.operationKinds || selector.operationKinds.includes(kind);

export const resolveWriteAuthorities = (operations, facts, { existingColumns = new Set() } = {}) => {
  const selectors = [...facts.flatMap(explicitSelectors), ...facts.flatMap(legacySelectors)], resolutions = [], unresolved = [], owners = new Map();
  for (const selector of selectors.filter((item) => item.resource)) { const key = `${selector.schema}.${selector.resource}`.toLowerCase(), ids = owners.get(key) ?? new Set(); ids.add(selector.fact.id); owners.set(key, ids); }
  const sharedResources = [...owners].filter(([, ids]) => ids.size > 1).map(([key]) => key).sort();
  operations.forEach((item, operationIndex) => {
    if (item.effect !== "WRITE") { if (item.effect === "UNKNOWN") unresolved.push({ code: item.analysisError ?? "WRITE_ANALYSIS_INCOMPLETE", operationIndex, sourcePath: item.sourcePath }); return; }
    const functionTarget = item.functionName, columns = item.functionName ? [null] : item.writtenColumns.length ? item.writtenColumns : [null];
    for (const column of columns) {
      const functionCandidates = functionTarget ? selectors.filter((selector) => selector.specificity === 3 && selector.functionName.toLowerCase() === functionTarget.toLowerCase() && allowsKind(selector, item.operationKind)) : [];
      let candidates = item.functionName || functionCandidates.length ? functionCandidates : selectors.filter((selector) => selector.specificity < 3 && selector.schema.toLowerCase() === item.schema?.toLowerCase() && selector.resource.toLowerCase() === item.resource?.toLowerCase() && allowsKind(selector, item.operationKind) && (selector.specificity === 1 || selector.column.toLowerCase() === column?.toLowerCase()));
      const resourceKey = `${item.schema}.${item.resource}`.toLowerCase(), isNewColumn = Boolean(column) && item.schemaChanging && !existingColumns.has(`${resourceKey}.${column}`.toLowerCase());
      if (!functionTarget && (isNewColumn || sharedResources.includes(resourceKey) && (!item.columnsKnown || !column))) candidates = candidates.filter((selector) => selector.specificity === 2);
      if (item.wholeResourceMutation) candidates = candidates.filter((selector) => selector.wholeResource);
      const specificity = Math.max(0, ...candidates.map((selector) => selector.specificity)), matches = [...new Map(candidates.filter((selector) => selector.specificity === specificity).map((selector) => [selector.fact.id, selector])).values()], target = functionCandidates.length || item.functionName ? functionTarget : `${item.schema}.${item.resource}${column ? `.${column}` : ""}`;
      if (!matches.length) unresolved.push({ code: "AUTHORITY_UNRESOLVED", target, operationIndex, sourcePath: item.sourcePath });
      else if (matches.length > 1) unresolved.push({ code: "AUTHORITY_AMBIGUOUS", target, authorities: matches.map((match) => match.fact.id).sort(), operationIndex, sourcePath: item.sourcePath });
      else resolutions.push({ operationIndex, sourcePath: item.sourcePath, operationKind: item.operationKind, target, column, authority: matches[0].fact.id, selectorSpecificity: specificity });
    }
  });
  return { resolutions, unresolved, sharedResources };
};

export const deriveFunctionAuthorities = (catalogue, facts, { existingColumns = new Set(), functionNames } = {}) => {
  const results = [], unresolved = [], reconciliations = [];
  for (const [functionName, fn] of catalogue) {
    if (functionNames && !functionNames.has(functionName)) continue;
    if (fn.effect === "READ") { results.push({ functionName, effect: "READ", authorityMode: "READ_ONLY", authorities: [] }); continue; }
    if (fn.effect === "UNKNOWN") { unresolved.push({ code: "RPC_EFFECT_UNKNOWN", functionName }); results.push({ functionName, effect: "UNKNOWN", authorityMode: "UNKNOWN", authorities: [] }); continue; }
    const body = resolveWriteAuthorities(fn.effectiveWrites.map((item) => ({ ...item, functionName: null })), facts, { existingColumns });
    if (body.unresolved.length) { unresolved.push(...body.unresolved.map((item) => ({ ...item, functionName }))); results.push({ functionName, effect: "WRITE", authorityMode: "UNRESOLVED", authorities: [] }); continue; }
    const authorities = [...new Set(body.resolutions.map((item) => item.authority))].sort(), declarations = facts.flatMap((fact) => (fact.writeSelectors ?? []).filter((selector) => (selector.function ?? selector.rpc)?.toLowerCase() === functionName.toLowerCase()).map((selector) => ({ fact, selector, declared: [...new Set(selector.delegatedAuthorities ?? [fact.id])].sort() })));
    if (!declarations.length) {
      if (authorities.length === 1) {
        const reconciliation = { code: "INTERNAL_REGISTRY_RECONCILIATION", functionName, authority: authorities[0], selector: { function: functionName } }; if (fn.externallyCallable) reconciliations.push(reconciliation);
        results.push({ functionName, effect: "WRITE", authorityMode: "DERIVED_SINGLE_AUTHORITY", authority: authorities[0], authorities, externallyCallable: fn.externallyCallable, registryStatus: fn.externallyCallable ? "RECONCILIATION_REQUIRED" : "INTERNAL_HELPER_DERIVED" });
      } else { unresolved.push({ code: "FUNCTION_AUTHORITY_AMBIGUOUS", functionName, authorities }); results.push({ functionName, effect: "WRITE", authorityMode: "MULTI_AUTHORITY_UNDECLARED", authorities }); }
      continue;
    }
    if (declarations.length !== 1 || JSON.stringify(declarations[0].declared) !== JSON.stringify(authorities)) { unresolved.push({ code: "FUNCTION_AUTHORITY_MISMATCH", functionName, derivedAuthorities: authorities, declaredAuthorities: declarations.flatMap((item) => item.declared).sort() }); continue; }
    const declaration = declarations[0], orchestration = authorities.length > 1;
    if (orchestration && declaration.fact.kind !== "ORCHESTRATION_CAPABILITY_ONLY") { unresolved.push({ code: "FUNCTION_AUTHORITY_AMBIGUOUS", functionName, authorities }); continue; }
    results.push({ functionName, effect: "WRITE", authorityMode: orchestration ? "DERIVED_ORCHESTRATION" : "DERIVED_SINGLE_AUTHORITY", authority: orchestration ? declaration.fact.id : authorities[0], authorities, externallyCallable: fn.externallyCallable, registryStatus: "DECLARATION_MATCHED" });
  }
  return { results, unresolved, reconciliations };
};
