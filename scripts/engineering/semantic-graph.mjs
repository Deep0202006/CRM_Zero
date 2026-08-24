import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const files = ["docs/engineering/DOMAIN_MAP.json", "docs/engineering/AUTHORITIES.json", "docs/engineering/CAPABILITIES.json", "docs/engineering/LESSONS.json"];
const text = (file) => readFileSync(resolve(root, file), "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = Object.fromEntries(files.map((file) => [file, hash(text(file))]));
const output = execFileSync("git", ["rev-parse", "--git-path", "zerograph/cache/semantic-graph.json"], { cwd: root, encoding: "utf8" }).trim();
const map = JSON.parse(text(files[0])); const authorities = JSON.parse(text(files[1])).facts; const capabilities = JSON.parse(text(files[2])).capabilities; const lessons = JSON.parse(text(files[3])).lessons;
const nodes = []; const edges = []; const add = (kind, id) => nodes.push({ kind, id });
for (const domain of map.domains) { add("DOMAIN", domain.id); for (const id of domain.authorityRefs ?? []) edges.push({ kind:"OWNS", from:domain.id, to:id }); for (const id of domain.capabilityRefs ?? []) edges.push({ kind:"USES", from:domain.id, to:id }); for (const path of domain.contractPaths ?? []) { add("CONTRACT", path); edges.push({ kind:"CONTRACTED_BY", from:domain.id, to:path }); } for (const path of domain.criticalTests ?? []) { add("TEST", path); edges.push({ kind:"TESTED_BY", from:domain.id, to:path }); } }
for (const item of authorities) add("AUTHORITY", item.id); for (const item of capabilities) add("CAPABILITY", item.id); for (const item of lessons) { add("LESSON", item.id); for (const claim of item.claims ?? []) { add("CLAIM", claim); edges.push({ kind:"PRESERVES_CLAIM", from:item.id, to:claim }); } }
mkdirSync(dirname(resolve(root, output)), { recursive:true }); writeFileSync(resolve(root, output), JSON.stringify({ schemaVersion:1, manifest, nodes:[...new Map(nodes.map((n)=>[`${n.kind}:${n.id}`,n])).values()], edges }, null, 2));
console.log(JSON.stringify({ output, nodes:nodes.length, edges:edges.length, manifest }, null, 2));
