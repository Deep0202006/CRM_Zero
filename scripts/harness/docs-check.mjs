import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { configPath, readJson, root, run } from "./common.mjs";

const config = readJson(configPath);
const errors = [];
for (const [name, domain] of Object.entries(config.domains)) {
  if (!existsSync(resolve(root, domain.contract))) errors.push(`${name}: missing contract ${domain.contract}`);
  for (const test of domain.tests) if (!existsSync(resolve(root, test))) errors.push(`${name}: missing configured test ${test}`);
}
const agentsArg = process.argv.find((arg) => arg.startsWith("--agents="));
const agentsPath = agentsArg ? resolve(root, agentsArg.slice("--agents=".length)) : resolve(root, "AGENTS.md");
const agents = readFileSync(agentsPath, "utf8");
for (const match of agents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const link = match[1].replace(/#.*$/, "");
  if (link && !/^https?:/.test(link) && !existsSync(resolve(root, link))) errors.push(`${agentsPath}: missing link ${link}`);
}
const active = resolve(root, "docs/exec-plans/active");
for (const name of readdirSync(active)) {
  const path = join(active, name);
  if (!name.endsWith(".md") || !statSync(path).isFile()) continue;
  const content = readFileSync(path, "utf8");
  for (const heading of ["Goal", "Non-goals", "Current state", "Invariants", "Affected domains", "Implementation steps", "Verification", "Production safety", "Rollback", "Decision log", "Progress"]) {
    if (!new RegExp(`^## ${heading}$`, "m").test(content)) errors.push(`${name}: missing heading ${heading}`);
  }
}
if (errors.length) { errors.forEach((e) => console.error(e)); process.exit(1); }
run("node", ["scripts/harness/repo-map.mjs", "--check"]);
console.log("Documentation checks passed.");
