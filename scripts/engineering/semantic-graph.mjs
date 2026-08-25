import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const files = [
  "docs/engineering/DOMAIN_MAP.json",
  "docs/engineering/AUTHORITIES.json",
  "docs/engineering/CAPABILITIES.json",
  "docs/engineering/LESSONS.json",
  "docs/engineering/PROOFS.json",
  "docs/engineering/CLAIMS.json",
];
const text = (file) => readFileSync(resolve(root, file), "utf8");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = Object.fromEntries(
  files.map((file) => [file, hash(text(file))]),
);
const output = execFileSync(
  "git",
  ["rev-parse", "--git-path", "zerograph/cache/semantic-graph.json"],
  { cwd: root, encoding: "utf8" },
).trim();
const map = JSON.parse(text(files[0]));
const authorities = JSON.parse(text(files[1])).facts;
const capabilities = JSON.parse(text(files[2])).capabilities;
const lessons = JSON.parse(text(files[3])).lessons;
const proofs = JSON.parse(text(files[4])).proofs;
const claims = JSON.parse(text(files[5])).claims;
const nodes = [],
  edges = [];
const add = (kind, id) => nodes.push({ kind, id });
const edge = (kind, from, to) => edges.push({ kind, from, to });
for (const domain of map.domains) {
  add("DOMAIN", domain.id);
  for (const id of domain.authorityRefs ?? []) edge("OWNS", domain.id, id);
  for (const id of domain.mustNotWriteAuthorityRefs ?? [])
    edge("MUST_NOT_WRITE", domain.id, id);
  for (const id of domain.capabilityRefs ?? []) edge("USES", domain.id, id);
  for (const path of [
    ...(domain.surfacePaths ?? []),
    ...(domain.codeRoots ?? []),
    ...(domain.serverBoundaries ?? []),
  ]) {
    add("PATH", path);
    edge("USES", domain.id, path);
  }
  for (const path of domain.contractPaths ?? []) {
    add("CONTRACT", path);
    edge("CONTRACTED_BY", domain.id, path);
  }
  for (const path of domain.criticalTests ?? []) {
    add("TEST", path);
    edge("TESTED_BY", domain.id, path);
  }
  for (const id of domain.proofRefs ?? []) edge("PROVED_BY", domain.id, id);
}
for (const item of authorities) add("AUTHORITY", item.id);
for (const item of capabilities) {
  add("CAPABILITY", item.id);
  for (const id of item.authorityRefs ?? []) edge("USES", item.id, id);
}
for (const item of proofs) {
  add("PROOF", item.id);
  for (const domain of item.domains ?? []) edge("PROVED_BY", domain, item.id);
  for (const path of item.paths ?? []) {
    add(item.kind === "unit" || item.kind === "e2e" ? "TEST" : "PATH", path);
    edge("TESTED_BY", item.id, path);
  }
}
for (const item of claims) add("CLAIM", item.id);
for (const item of lessons) {
  add("LESSON", item.id);
  for (const claim of item.claims ?? [])
    edge("PRESERVES_CLAIM", item.id, claim);
}
const unique = (items) => [
  ...new Map(items.map((item) => [JSON.stringify(item), item])).values(),
];
const graph = {
  schemaVersion: 2,
  manifest,
  nodes: unique(nodes),
  edges: unique(edges),
};
mkdirSync(dirname(resolve(root, output)), { recursive: true });
writeFileSync(resolve(root, output), `${JSON.stringify(graph, null, 2)}\n`);
console.log(
  JSON.stringify(
    { output, nodes: graph.nodes.length, edges: graph.edges.length, manifest },
    null,
    2,
  ),
);
