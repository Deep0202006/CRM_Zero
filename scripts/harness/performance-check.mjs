import fs from "node:fs";
import path from "node:path";
import { artifacts, countWords, readJson } from "./cli.mjs";

const baseline = readJson("harness/performance-baseline.json");
const metadata = readJson(".codex-artifacts/context-metadata.json");
const review = fs.readFileSync(path.join(artifacts, "review-pack.md"), "utf8");
const handoff = fs.readFileSync(path.join(artifacts, "implementation-handoff.md"), "utf8");
const evidence = fs.existsSync(path.join(artifacts, "performance-evidence.json"))
  ? JSON.parse(fs.readFileSync(path.join(artifacts, "performance-evidence.json"), "utf8"))
  : {};
const current = {
  contextWords: metadata.words,
  contextFiles: metadata.filesIncluded,
  contextBytes: metadata.bytes,
  quickDurationMs: evidence.quickDurationMs ?? null,
  fullDurationMs: evidence.fullDurationMs ?? null,
  reviewPackWords: countWords(review),
  handoffWords: countWords(handoff)
};
const failures = [];
if (current.contextWords > 1500) failures.push("Context exceeds 1,500 words.");
if (current.contextBytes > 61440) failures.push("Context exceeds 60 KB.");
if (current.reviewPackWords > 800) failures.push("Review pack exceeds 800 words.");
if (current.handoffWords > 600) failures.push("Handoff exceeds 600 words.");
for (const key of ["contextWords", "contextFiles", "contextBytes", "quickDurationMs", "fullDurationMs"]) {
  if (current[key] != null && current[key] > baseline[key] * 1.25) console.warn(`WARNING: ${key} regressed more than 25% (${current[key]} vs ${baseline[key]}).`);
}
fs.writeFileSync(path.join(artifacts, "performance-result.json"), `${JSON.stringify({ baseline, current, failures }, null, 2)}\n`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(JSON.stringify(current));
