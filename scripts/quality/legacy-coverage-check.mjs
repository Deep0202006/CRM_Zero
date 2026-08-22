import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const graph = "ae7db36287a1f1fd2e70e7dbd36ed463a0f52ef6";
const harness = "f8d5d5c7bca84cb16d2d378aa1c0bab685f79f4b";
const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const historic = (commit, path) => run(["show", `${commit}:${path}`]);
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const json = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
const coverage = json("docs/engineering/LEGACY_COVERAGE.json");
const current = { lesson: new Set(json("docs/engineering/LESSONS.json").lessons.map((x) => x.id)), authority: new Set(json("docs/engineering/AUTHORITIES.json").facts.map((x) => x.id)), capability: new Set(json("docs/engineering/CAPABILITIES.json").capabilities.map((x) => x.id)), contract: null, invariant: null };
const sources = [
  ["graph-lessons", graph, ".crm-engineering/knowledge/lessons-registry.json", "lesson", (t) => JSON.parse(t).lessons.map((x) => x.id)],
  ["graph-rules", graph, ".crm-engineering/policy/rules.json", "rule", (t) => JSON.parse(t).rules.map((x) => x.id)],
  ["graph-authorities", graph, ".crm-engineering/knowledge/authority-registry.json", "authority", (t) => JSON.parse(t).facts.map((x) => x.id)],
  ["graph-capabilities", graph, ".crm-engineering/knowledge/capability-registry.json", "capability", (t) => JSON.parse(t).capabilities.map((x) => x.id)],
  ["os-ledger", harness, "docs/os/LESSONS_LEDGER.md", "ledger", (t) => t.split(/\r?\n/).filter((line) => /^\|\s*20\d\d-/.test(line)).map(hash)],
  ["golden-principles", harness, "docs/quality/GOLDEN_PRINCIPLES.md", "principle", (t) => t.split(/\r?\n/).filter((line) => /^- /.test(line)).map(hash)]
];
const fail = (message) => { console.error(`legacy: ${message}`); process.exitCode = 1; };
if (coverage.schemaVersion !== 2) fail("schemaVersion must be 2");
let total = 0;
for (const [sourceId, commit, path, type, extract] of sources) {
  const text = historic(commit, path); const expected = extract(text); total += expected.length;
  const source = coverage.sources.find((x) => x.sourceId === sourceId);
  if (!source || source.commit !== commit || source.path !== path || source.sourceHash !== run(["rev-parse", `${commit}:${path}`]).trim()) { fail(`source provenance mismatch: ${sourceId}`); continue; }
  const actual = source.items.map((x) => x.legacyId);
  if (new Set(actual).size !== actual.length || actual.length !== expected.length || actual.some((id) => !expected.includes(id)) || expected.some((id) => !actual.includes(id))) fail(`source set mismatch: ${sourceId}`);
  for (const item of source.items) { const r = item.resolution ?? {}; if (!r.ref || !r.reason || !["lesson","authority","capability","contract","invariant","obsolete"].includes(r.type)) fail(`bad resolution: ${sourceId}/${item.legacyId}`); else if (["lesson","authority","capability"].includes(r.type) && !current[r.type].has(r.ref)) fail(`missing current ref: ${sourceId}/${item.legacyId}`); else if (["contract","invariant"].includes(r.type) && !readFileSync(resolve(root, r.ref), "utf8")) fail(`missing file ref: ${sourceId}/${item.legacyId}`); }
}
if (total !== 178) fail(`SOURCE_INVENTORY_MISMATCH: ${total}`);
for (const source of coverage.sources.filter((x) => x.sourceType === "policy" || x.sourceType === "snapshot")) for (const item of source.items ?? []) if (!item.resolution?.ref || !item.resolution?.reason) fail(`policy resolution missing: ${source.sourceId}`);
if (!process.exitCode) console.log("Legacy coverage passed (178/178 structured records).");
