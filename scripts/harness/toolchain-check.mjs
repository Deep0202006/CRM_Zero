import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root } from "./cli.mjs";

const expectedNode = fs.readFileSync(path.join(root, ".node-version"), "utf8").trim();
const expectedNpm = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).engines.npm;
if (process.version !== `v${expectedNode}`) {
  console.error(`Expected Node v${expectedNode}, received ${process.version}.`);
  process.exit(1);
}
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
let actualNpm = execFileSync(npmCommand, ["--version"], { encoding: "utf8" }).trim();
if (actualNpm !== expectedNpm && process.argv.includes("--install-npm")) {
  execFileSync(npmCommand, ["install", "--global", `npm@${expectedNpm}`], { stdio: "inherit" });
  actualNpm = execFileSync(npmCommand, ["--version"], { encoding: "utf8" }).trim();
}
if (actualNpm !== expectedNpm) {
  console.error(`Expected npm ${expectedNpm}, received ${actualNpm}.`);
  process.exit(1);
}
console.log(`Toolchain verified: Node ${process.version}, npm ${actualNpm}.`);
