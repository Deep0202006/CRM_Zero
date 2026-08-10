import { changedPaths, manifest, matchesPath } from "./common.mjs";

const task = manifest();
const ignoredRuntime = [".harness/current-audit.md", ".harness/task.json"];
const pathsArg = process.argv.find((arg) => arg.startsWith("--paths="));
const governedPaths = pathsArg ? pathsArg.slice("--paths=".length).split(",").filter(Boolean) : changedPaths();
const unexpected = governedPaths.filter((file) =>
  !ignoredRuntime.includes(file) &&
  !(task.untrackedBaseline ?? []).some((baseline) => matchesPath(file, baseline)) &&
  !task.allowedPaths.some((allowed) => matchesPath(file, allowed))
);
if (unexpected.length) {
  console.error("Scope guard failed. Re-plan explicitly before changing these paths:");
  unexpected.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}
console.log(`Scope guard passed (${governedPaths.length - ignoredRuntime.filter((p) => governedPaths.includes(p)).length} governed paths).`);
