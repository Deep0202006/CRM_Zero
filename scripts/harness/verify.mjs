import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { manifest, root, run } from "./common.mjs";

const task = manifest();
const listOnly = process.argv.includes("--list");
const gates = {
  R0: [["npm", ["run", "harness:scope"]], ["npm", ["run", "harness:guard"]], ["npm", ["run", "harness:related"]], ["npm", ["run", "harness:docs"]]],
  R1: [["npm", ["run", "harness:scope"]], ["npm", ["run", "harness:guard"]], ["npm", ["run", "harness:related", "--", "--run"]], ["npm", ["run", "typecheck"]], ["npm", ["run", "lint"]]],
  R2: [["npm", ["run", "harness:scope"]], ["npm", ["run", "harness:guard"]], ["npm", ["run", "harness:related", "--", "--run"]], ["npm", ["test", "--", "--runInBand"]], ["npm", ["run", "typecheck"]], ["npm", ["run", "lint"]], ["npm", ["run", "build"]]],
};
if (task.risk === "R3") {
  const active = resolve(root, "docs/exec-plans/active");
  const plans = readdirSync(active).filter((name) => name.endsWith(".md"));
  if (!plans.length) { console.error("R3 verification requires an active ExecPlan."); process.exit(1); }
  if (!plans.some((name) => /## Production safety[\s\S]*- \[[xX]\]/.test(readFileSync(resolve(active, name), "utf8")))) {
    console.error("R3 verification requires an explicitly checked production-safety checklist."); process.exit(1);
  }
}
const selected = task.risk === "R3" ? gates.R2 : gates[task.risk];
if (listOnly) {
  for (const [command, args] of selected) console.log([command, ...args].join(" "));
  process.exit(0);
}
for (const [command, args] of selected) run(command, args);
console.log(`Harness verification passed for ${task.risk}.`);
