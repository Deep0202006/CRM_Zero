import { existsSync } from "node:fs";
import { changedPaths, git, logList, manifest, root } from "./common.mjs";

console.log(`Repository: ${root}`);
console.log(`Branch: ${git(["branch", "--show-current"]) || "DETACHED"}`);
console.log(`SHA: ${git(["rev-parse", "HEAD"])}`);
console.log(`Status: ${git(["status", "--short"]) || "clean"}`);
const task = manifest(false);
console.log(`Task manifest: ${task ? `${task.risk} ${task.task}` : "missing (required before implementation)"}`);
if (task) {
  const config = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../../harness.config.json", import.meta.url), "utf8"));
  const docs = task.domains.map((name) => config.domains[name]?.contract).filter(Boolean);
  for (const doc of docs) if (!existsSync(new URL(`../../${doc}`, import.meta.url))) throw new Error(`Missing relevant contract: ${doc}`);
  logList("Relevant domain docs", [...new Set(docs)]);
  if (task.productionDataMutation || task.schemaChange) console.log("Safety: R3 effects declared; active plan and explicit authorization required.");
  else console.log("Safety: no production mutation or schema change declared.");
}
logList("Changed paths", changedPaths());
