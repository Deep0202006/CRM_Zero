import ts from "typescript";

const qualified = (value, defaultSchema = "public") => {
  const parts = String(value ?? "").replaceAll('"', "").split(".").filter(Boolean);
  return parts.length > 1 ? { schema: parts.at(-2), resource: parts.at(-1) } : { schema: defaultSchema, resource: parts[0] ?? null };
};
const literal = (node) => node && ts.isStringLiteralLike(node) ? node.text : null;
const callTarget = (node, method) => {
  if (!node) return null;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    if (node.expression.name.text === method) return literal(node.arguments[0]);
    return callTarget(node.expression.expression, method);
  }
  return ts.isPropertyAccessExpression(node) ? callTarget(node.expression, method) : null;
};
const objectKeys = (node) => {
  const values = ts.isArrayLiteralExpression(node) ? node.elements : [node];
  return [...new Set(values.flatMap((value) => ts.isObjectLiteralExpression(value) ? value.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) return [];
    const name = property.name;
    return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) ? [name.text] : [];
  }) : []))];
};

export const extractSourceWrites = (path, added) => {
  if (!/\.(?:c?js|mjs|mts|cts|jsx|tsx?)$/i.test(path) || !added.trim()) return [];
  const source = ts.createSourceFile(path, `async function __impact_fixture__(){\n${added}\n}`, ts.ScriptTarget.Latest, true, /\.tsx?$/i.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.JS), writes = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const operationKind = node.expression.name.text;
      if (["insert", "upsert", "update", "delete"].includes(operationKind)) {
        const target = callTarget(node.expression.expression, "from");
        if (target) {
          const { schema, resource } = qualified(target, callTarget(node.expression.expression, "schema") ?? "public");
          writes.push({ sourcePath: path, operationKind, schema, resource, writtenColumns: operationKind === "delete" ? [] : objectKeys(node.arguments[0]), functionName: null, isDml: true, schemaChanging: false, enclosingFunction: null });
        }
      }
      if (operationKind === "rpc") {
        const target = literal(node.arguments[0]);
        if (target) {
          const { schema, resource } = qualified(target);
          writes.push({ sourcePath: path, operationKind: "rpc", schema, resource: null, writtenColumns: objectKeys(node.arguments[1]), functionName: `${schema}.${resource}`, isDml: true, schemaChanging: false, enclosingFunction: null });
        }
      }
      if (/^(?:createUser|deleteUser|updateUserById|inviteUserByEmail|generateLink|signOut)$/.test(operationKind) && added.slice(Math.max(0, node.pos - 80), node.end).includes(".auth.admin")) {
        writes.push({ sourcePath: path, operationKind: "auth_admin", schema: "auth", resource: "users", writtenColumns: objectKeys(node.arguments[1] ?? node.arguments[0]), functionName: `auth.admin.${operationKind}`, isDml: true, schemaChanging: false, enclosingFunction: null });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!writes.length && source.parseDiagnostics.length && !/(?:__tests__|\.test\.|\.spec\.|^e2e\/)/i.test(path)) {
    for (const match of added.matchAll(/\.from\s*\(\s*["']([^"']+)["']\s*\)[\s\S]*?\.(insert|upsert|update|delete)\s*\(\s*\{([^}]*)\}/gi)) {
      const { schema, resource } = qualified(match[1]);
      writes.push({ sourcePath: path, operationKind: match[2].toLowerCase(), schema, resource, writtenColumns: [...match[3].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?::|,|$)/g)].map((item) => item[1]), functionName: null, isDml: true, schemaChanging: false, enclosingFunction: null });
    }
    for (const match of added.matchAll(/\.rpc\s*\(\s*["']([^"']+)["']/gi)) {
      const { schema, resource } = qualified(match[1]);
      writes.push({ sourcePath: path, operationKind: "rpc", schema, resource: null, writtenColumns: [], functionName: `${schema}.${resource}`, isDml: true, schemaChanging: false, enclosingFunction: null });
    }
  }
  return writes;
};

const sqlFunctions = (sql) => [...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:"?[\w]+"?\.)?"?[\w]+"?)[\s\S]*?\bAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\2/gi)].map((match) => {
  const { schema, resource } = qualified(match[1]);
  const bodyOffset = match[0].indexOf(match[3]);
  return { name: `${schema}.${resource}`, start: match.index + bodyOffset, end: match.index + bodyOffset + match[3].length };
});
const sqlColumns = (value) => [...new Set(String(value).split(",").map((item) => /^\s*"?([A-Za-z_][\w]*)"?/.exec(item)?.[1]).filter(Boolean))];
const sqlOperation = (path, kind, target, columns, schemaChanging, index, functions) => {
  const { schema, resource } = qualified(target);
  return { sourcePath: path, operationKind: kind, schema, resource, writtenColumns: columns, functionName: null, isDml: !schemaChanging, schemaChanging, enclosingFunction: functions.find((item) => index >= item.start && index <= item.end)?.name ?? null };
};

export const extractSqlWrites = (path, added) => {
  if (!/\.sql$/i.test(path) || !added.trim()) return [];
  const sql = added.replace(/--[^\r\n]*/g, ""), functions = sqlFunctions(sql), writes = [];
  for (const match of sql.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)([\s\S]*?);/gi)) {
    for (const column of match[2].matchAll(/\b(ADD|DROP|ALTER)\s+(?:COLUMN\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([A-Za-z_][\w]*)"?/gi)) {
      if (column[2].toLowerCase() === "constraint") continue;
      writes.push(sqlOperation(path, `alter_table_${column[1].toLowerCase()}_column`, match[1], [column[2]], true, match.index + column.index, functions));
    }
  }
  for (const match of sql.matchAll(/\bUPDATE\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s+SET\s+([\s\S]*?)(?=\bWHERE\b|\bFROM\b|\bRETURNING\b|;|$)/gi)) writes.push(sqlOperation(path, "update", match[1], [...match[2].matchAll(/(?:^|,)\s*"?([A-Za-z_][\w]*)"?\s*=/g)].map((item) => item[1]), false, match.index, functions));
  for (const match of sql.matchAll(/\bINSERT\s+INTO\s+((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(([^)]*)\)/gi)) writes.push(sqlOperation(path, "insert", match[1], sqlColumns(match[2]), false, match.index, functions));
  for (const match of sql.matchAll(/\bDELETE\s+FROM\s+((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)) writes.push(sqlOperation(path, "delete", match[1], [], false, match.index, functions));
  for (const match of sql.matchAll(/\bTRUNCATE(?:\s+TABLE)?\s+((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)) writes.push(sqlOperation(path, "truncate", match[1], [], false, match.index, functions));
  for (const match of sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s*\(([\s\S]*?)\)\s*;/gi)) writes.push(sqlOperation(path, "create_table", match[1], sqlColumns(match[2]).filter((column) => !/^(?:constraint|primary|unique|check|foreign)$/i.test(column)), true, match.index, functions));
  for (const match of sql.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)) writes.push(sqlOperation(path, "drop_table", match[1], [], true, match.index, functions));
  return writes;
};

const explicitSelectors = (fact) => (fact.writeSelectors ?? []).flatMap((selector) => {
  if (selector.function || selector.rpc) return [{ fact, specificity: 3, functionName: selector.function ?? selector.rpc }];
  const resource = selector.resource ?? selector.table;
  const columns = selector.columns ?? (selector.column ? [selector.column] : []);
  return columns.length ? columns.map((column) => ({ fact, specificity: 2, schema: selector.schema ?? "public", resource, column })) : resource ? [{ fact, specificity: 1, schema: selector.schema ?? "public", resource }] : [];
});
const legacySelectors = (fact, operation) => {
  const values = [...String(fact.authority ?? "").matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g)].map((match) => ({ schema: match[1], resource: match[2], column: match[3] ?? null, index: match.index }));
  if (operation.functionName) return values.filter((value) => !value.column && (String(fact.authority).slice(0, value.index).includes("via") || `${value.schema}.${value.resource}` === String(fact.authority).trim())).map((value) => ({ fact, specificity: 3, functionName: `${value.schema}.${value.resource}` }));
  return values.map((value) => ({ fact, specificity: value.column ? 2 : 1, schema: value.schema, resource: value.resource, column: value.column }));
};

export const resolveWriteAuthorities = (operations, facts) => {
  const introduced = new Set(operations.filter((operation) => operation.operationKind === "alter_table_add_column" || operation.operationKind === "create_table").flatMap((operation) => operation.writtenColumns.map((column) => `${operation.schema}.${operation.resource}.${column}`.toLowerCase()))), resolutions = [], unresolved = [];
  operations.forEach((operation, operationIndex) => {
    const columns = operation.functionName ? [null] : operation.writtenColumns.length ? operation.writtenColumns : [null];
    for (const column of columns) {
      const selectors = facts.flatMap((fact) => [...explicitSelectors(fact), ...legacySelectors(fact, operation)]).filter((selector) => operation.functionName
        ? selector.specificity === 3 && selector.functionName.toLowerCase() === operation.functionName.toLowerCase()
        : selector.specificity < 3 && selector.schema.toLowerCase() === operation.schema.toLowerCase() && selector.resource.toLowerCase() === operation.resource.toLowerCase() && (selector.specificity === 1 || selector.column.toLowerCase() === column?.toLowerCase()));
      const requiresColumn = column && introduced.has(`${operation.schema}.${operation.resource}.${column}`.toLowerCase());
      const eligible = requiresColumn ? selectors.filter((selector) => selector.specificity === 2 && (selector.fact.writeSelectors ?? []).length) : selectors;
      const specificity = Math.max(0, ...eligible.map((selector) => selector.specificity)), matches = [...new Map(eligible.filter((selector) => selector.specificity === specificity).map((selector) => [selector.fact.id, selector])).values()];
      const target = operation.functionName ?? `${operation.schema}.${operation.resource}${column ? `.${column}` : ""}`;
      if (!matches.length) unresolved.push({ code: "AUTHORITY_UNRESOLVED", target, operationIndex, sourcePath: operation.sourcePath });
      else if (matches.length > 1) unresolved.push({ code: "AUTHORITY_AMBIGUOUS", target, authorities: matches.map((match) => match.fact.id).sort(), operationIndex, sourcePath: operation.sourcePath });
      else resolutions.push({ operationIndex, sourcePath: operation.sourcePath, operationKind: operation.operationKind, target, column, authority: matches[0].fact.id, selectorSpecificity: specificity });
    }
  });
  return { resolutions, unresolved };
};
