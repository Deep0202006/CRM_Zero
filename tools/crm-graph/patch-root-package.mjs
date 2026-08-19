import fs from "node:fs";

const p = new URL("../../package.json", import.meta.url);
const file = p.pathname.startsWith("/") && /^[A-Za-z]:/.test(p.pathname.slice(1))
  ? p.pathname.slice(1)
  : p.pathname;

const pkg = JSON.parse(fs.readFileSync(file,"utf8"));
pkg.scripts ??= {};
Object.assign(pkg.scripts, {
  "crm:status":"npm --prefix tools/crm-graph run status --",
  "crm:context":"npm --prefix tools/crm-graph run context --",
  "crm:index":"npm --prefix tools/crm-graph run index --",
  "crm:shadow":"npm --prefix tools/crm-graph run shadow --",
  "crm:run":"npm --prefix tools/crm-graph run run --",
  "crm:graph:test":"npm --prefix tools/crm-graph test",
  "crm:graph:typecheck":"npm --prefix tools/crm-graph run typecheck"
});
fs.writeFileSync(file, JSON.stringify(pkg,null,2)+"\n","utf8");
console.log("Patched root package.json CRM graph scripts.");
