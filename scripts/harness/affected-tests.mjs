import { args, changedFiles, globMatch, loadAreas } from "./cli.mjs";

const options = args();
const files = changedFiles(options.base);
const reasons = new Map();
if (files.some((file) => /^(?:harness|scripts\/harness|tests\/harness)\//.test(file))) {
  reasons.set("npm run harness:self-test", ["Harness policy or implementation changed"]);
}
for (const file of files) {
  if (!/^(?:src|supabase)\//.test(file)) continue;
  const matched = loadAreas().filter((area) =>
    [...area.entrypoints, ...area.sharedDependencies, ...area.allowedDefaultPaths].some((pattern) => globMatch(file, pattern))
  );
  if (!matched.length) {
    console.error(`No affected-test mapping for production file: ${file}`);
    process.exit(1);
  }
  for (const area of matched) for (const test of area.requiredTests) {
    const entries = reasons.get(test) ?? [];
    entries.push(`${file} maps to ${area.name}`);
    reasons.set(test, entries);
  }
}
if (!reasons.size) {
  console.error("No affected tests selected. Update an area capsule or pass a base containing production changes.");
  process.exit(1);
}
for (const [test, why] of [...reasons].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${test}\n  ${[...new Set(why)].join("; ")}`);
}
if (options.run) {
  const jest = [...reasons.keys()].filter((item) => item.endsWith(".test.ts"));
  console.log(`RUN_JEST=${jest.join(",")}`);
}
