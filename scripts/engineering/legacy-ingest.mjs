import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../.."), hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const relevant = /(^|\/)(AGENTS\.md|docs\/(os|quality|architecture|contracts|engineering[^/]*|exec-plans|data-platform-repair)\/|\.harness\/|\.crm-engineering\/(manifest|policy|knowledge|tasks|proofs|schemas)\/|tools\/crm-graph\/|scripts\/[^/]*(engineering|harness)|\.archive\/.*(engineering|harness)|skills\/.*(zero|crm))/i;
const excluded = /(^|\/)(node_modules|\.next|dist|coverage|playwright-report|test-results)(\/|$)|(^|\/)\.env|secret|credential|\.(png|jpe?g|gif|webp|zip|gz|pdf)$/i;
const classify = (path) => excluded.test(path) ? "SENSITIVE_SKIPPED" : relevant.test(path) ? "KNOWLEDGE_USED" : /skills\//i.test(path) ? "GENERIC_TOOLING" : "NON_KNOWLEDGE";
const candidates = git("rev-list", "--objects", "--all").split(/\r?\n/).map((line) => { const split = line.indexOf(" "); return split < 0 ? null : { blobHash: line.slice(0, split), path: line.slice(split + 1).replaceAll("\\", "/") }; }).filter(Boolean).filter(({ path }) => relevant.test(path) || /skills\//i.test(path));
const types = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { cwd: root, encoding: "utf8", input: candidates.map(({ blobHash }) => blobHash).join("\n") }).stdout.split(/\r?\n/).reduce((map, line) => { const [id,type] = line.split(" "); if (id) map.set(id,type); return map; }, new Map());
const objects = candidates.filter(({ blobHash }) => types.get(blobHash) === "blob");
const byBlob = new Map(), sources = [], records = [], normalized = (value) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
for (const item of objects) {
  const classification = classify(item.path);
  if (byBlob.has(item.blobHash)) { sources.push({ ...item, classification: "DUPLICATE", duplicateOf: byBlob.get(item.blobHash) }); continue; }
  byBlob.set(item.blobHash, item.path); let content = "";
  if (classification === "KNOWLEDGE_USED") try { content = execFileSync("git", ["cat-file", "blob", item.blobHash], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }); } catch { sources.push({ ...item, classification: "SENSITIVE_SKIPPED" }); continue; }
  sources.push({ ...item, classification });
  if (classification !== "KNOWLEDGE_USED") continue;
  if (basename(item.path).toLowerCase() === "lessons_ledger.md") for (const line of content.split(/\r?\n/).filter((row) => /^\|\s*20\d\d-/.test(row))) {
    const cells = line.split("|").map(normalized), rule = cells[5]; if (rule) records.push({ sourceRef: item.path, sourceBlobHash: item.blobHash, normalizedRule: rule });
  }
  if (/lessons-registry\.json$/i.test(item.path)) try { for (const lesson of JSON.parse(content).lessons ?? []) { const rule = normalized(lesson.rule ?? lesson.title ?? lesson.id); if (rule) records.push({ sourceRef: item.path, sourceBlobHash: item.blobHash, normalizedRule: rule, legacyId: lesson.id }); } } catch {}
  if (/policy\/rules\.json$/i.test(item.path)) try { for (const ruleItem of JSON.parse(content).rules ?? []) { const rule = normalized(ruleItem.title ?? ruleItem.rule ?? ruleItem.id); if (rule) records.push({ sourceRef: item.path, sourceBlobHash: item.blobHash, normalizedRule: rule, legacyId: ruleItem.id }); } } catch {}
}
const external = process.env.ZEROGRAPH_LEGACY_CORPUS;
if (external) { const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name), rel = relative(external, path).replaceAll("\\", "/"); if (excluded.test(rel)) continue; if (statSync(path).isDirectory()) walk(path); else { const content = readFileSync(path); sources.push({ blobHash: hash(content), path: `external:${rel}`, classification: relevant.test(rel) ? "KNOWLEDGE_USED" : "NON_KNOWLEDGE" }); } } }; walk(resolve(external)); }
const unique = [...new Map(records.map((record) => { const ruleTextHash = hash(record.normalizedRule); return [ruleTextHash, { legacyId: record.legacyId ?? `LEGACY_${ruleTextHash.slice(0, 16)}`, ...record, ruleTextHash, claims: [], domains: [], severity: null }]; })).values()];
const ledgerBlobs = new Set(sources.filter((source) => /LESSONS_LEDGER\.md$/i.test(source.path) && source.classification === "KNOWLEDGE_USED").map((source) => source.blobHash));
const sourceHashes = [...new Set(sources.map((source) => source.blobHash))].sort(), rawLessonRowCount = records.filter((record) => /LESSONS_LEDGER\.md$/i.test(record.sourceRef)).length;
const summary = { sourceBlobCount: sourceHashes.length, ledgerVersionCount: ledgerBlobs.size, rawLessonRowCount, uniqueNormalizedRules: unique.length, corpusCanary: external ? { minimumRawRows: 384, status: rawLessonRowCount >= 384 ? "PASS" : "FAIL" } : { status: "NOT_APPLICABLE", reason: "ZEROGRAPH_LEGACY_CORPUS not supplied" } };
if (summary.ledgerVersionCount < 20 || unique.length < 29 || summary.corpusCanary.status === "FAIL") { console.error(JSON.stringify({ code: "LEGACY_SOURCE_INCOMPLETE", ...summary })); process.exit(2); }
const output = { schemaVersion: 1, generatedFrom: "git rev-list --objects --all", summary, sourceHashes, sources: sources.sort((a,b)=>a.path.localeCompare(b.path)||a.blobHash.localeCompare(b.blobHash)), records: unique.sort((a,b)=>a.ruleTextHash.localeCompare(b.ruleTextHash)) };
if (process.argv.includes("--write")) writeFileSync(resolve(root, "docs/engineering/LEGACY_KNOWLEDGE.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(summary));
