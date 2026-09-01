import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveAssignment = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:APPLIED_OWNER_MIGRATIONS\.json|inspectMigrationBoundaryTransition\s*\(|doctor\s*\()[^;\n]*/g;
const literalEquality = (name) => new RegExp(`(?:assert\\.(?:equal|strictEqual)\\(\\s*${name}\\.(?:immutableThrough|lastAppliedOwnerMigration|nextLegalMigration|baseImmutableThrough)\\s*,\\s*\\d+\\s*\\)|expect\\(\\s*${name}\\.(?:immutableThrough|lastAppliedOwnerMigration|nextLegalMigration|baseImmutableThrough)\\s*\\)\\.toBe\\(\\s*\\d+\\s*\\))`);

export const mutableCurrentStateLiteralViolations = (source, path = "fixture.test.mjs") => {
  const violations = [];
  for (const match of source.matchAll(liveAssignment)) if (literalEquality(match[1]).test(source)) violations.push({ path, variable: match[1], code: "MUTABLE_CURRENT_STATE_LITERAL" });
  return violations;
};

export const scanMutableCurrentStateLiterals = (paths) => (paths ?? execFileSync("git", ["ls-files", "-z", "--", "*.test.js", "*.test.mjs", "*.test.ts", "*.test.tsx", "scripts/engineering/kernel.test.mjs"], { cwd: root }).toString("utf8").split("\0").filter(Boolean))
  .flatMap((path) => mutableCurrentStateLiteralViolations(readFileSync(resolve(root, path), "utf8"), path));

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const violations = scanMutableCurrentStateLiterals();
  console.log(JSON.stringify({ code: violations.length ? "MUTABLE_CURRENT_STATE_LITERAL_FOUND" : "DYNAMIC_STATE_GUARD_PASS", violations }, null, 2));
  if (violations.length) process.exitCode = 1;
}
