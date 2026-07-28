import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { artifacts, readJson, root } from "./cli.mjs";

const baseline = readJson("harness/security-audit-baseline.json");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required.");
const result = spawnSync(process.execPath, [npmCli, "audit", "--json"], { cwd: root, encoding: "utf8", shell: false });
let audit;
try { audit = JSON.parse(result.stdout); } catch {
  console.error("npm audit did not return valid JSON.");
  process.exit(1);
}
const today = new Date();
const accepted = new Map(baseline.acceptedHighAdvisories.map((item) => [String(item.advisoryId), item]));
const currentHigh = new Map();
const criticalPackages = [];
for (const [packageName, vulnerability] of Object.entries(audit.vulnerabilities ?? {})) {
  if (vulnerability.severity === "critical") criticalPackages.push(packageName);
  for (const via of vulnerability.via ?? []) {
    if (typeof via !== "object" || !via.source || !["high", "critical"].includes(via.severity)) continue;
    currentHigh.set(String(via.source), { package: via.name ?? packageName, severity: via.severity, title: via.title });
  }
}
const failures = [];
if (criticalPackages.length) failures.push(`Critical findings: ${criticalPackages.join(", ")}`);
for (const [id, finding] of currentHigh) {
  const entry = accepted.get(id);
  if (!entry) failures.push(`New unbaselined ${finding.severity} advisory ${id} (${finding.package})`);
  else {
    if (new Date(`${entry.expiryDate}T23:59:59Z`) < today) failures.push(`Expired exception ${id} (${entry.package})`);
    if (finding.severity === "critical") failures.push(`Advisory ${id} worsened to critical`);
  }
}
for (const entry of baseline.acceptedHighAdvisories) {
  if (!entry.owner || !entry.assessment || !entry.mitigation || !entry.dependencyPath) failures.push(`Incomplete baseline record ${entry.advisoryId}`);
}
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, "security-audit-result.json"), `${JSON.stringify({
  node: process.version,
  npm: process.env.npm_execpath ? spawnSync(process.execPath, [process.env.npm_execpath, "--version"], { encoding: "utf8" }).stdout.trim() : "unknown",
  critical: criticalPackages,
  acceptedHigh: [...currentHigh.keys()].filter((id) => accepted.has(id)),
  newHigh: [...currentHigh.keys()].filter((id) => !accepted.has(id)),
  expired: baseline.acceptedHighAdvisories.filter((item) => new Date(`${item.expiryDate}T23:59:59Z`) < today).map((item) => item.advisoryId),
  aggregate: audit.metadata?.vulnerabilities
}, null, 2)}\n`);
if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Security audit baseline accepted ${currentHigh.size} high advisories; 0 critical, 0 new high, 0 expired.`);
