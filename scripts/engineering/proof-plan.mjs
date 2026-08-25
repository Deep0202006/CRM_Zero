import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { resolveProofPath } from "./proof-path.mjs";
const root = resolve(import.meta.dirname, "../.."),
  args = process.argv.slice(2),
  value = (k) => {
    const i = args.indexOf(k);
    return i < 0 ? undefined : args[i + 1];
  },
  base = value("--base") ?? "origin/main",
  head = value("--head") ?? "HEAD",
  run = (...a) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim(),
  impact = JSON.parse(
    execFileSync(
      "node",
      ["scripts/engineering/impact.mjs", "--base", base, "--head", head],
      { cwd: root, encoding: "utf8" },
    ),
  ),
  proofs = JSON.parse(
    readFileSync(resolve(root, "docs/engineering/PROOFS.json")),
  ).proofs;
const applicable = (p) =>
  impact.domains.some((d) => (p.domains ?? []).includes(d)) &&
  impact.effects.some((e) => (p.effects ?? []).includes(e));
const required = proofs
  .filter((p) =>
    impact.domains.includes("engineering-control")
      ? p.controlPlaneCoverage === true
      : applicable(p),
  )
  .map((proof) => ({
    ...proof,
    paths: (proof.paths ?? []).map(
      (path) => resolveProofPath(root, base, head, path).path,
    ),
  }));
const concreteHandover = impact.changedPaths.some((path) =>
  /^(docs|scripts)\/handover\//.test(path),
);
if (
  concreteHandover &&
  !required.some(
    (p) =>
      p.kind === "handover" && (p.domains ?? []).includes("platform-handover"),
  )
) {
  console.error("HANDOVER_PROOF_UNMAPPED");
  process.exit(2);
}
if (
  !concreteHandover &&
  ["DATABASE", "AUTHORIZATION", "SECURITY"].some((e) =>
    impact.effects.includes(e),
  ) &&
  !required.some((p) => p.kind === "postgres")
) {
  console.error("R3_DB_PROOF_UNMAPPED");
  process.exit(2);
}
const migrations = impact.changedPaths.filter((path) =>
  /^supabase\/migrations\/\d+_.*\.sql$/.test(path),
);
if (migrations.length) {
  const numbers = migrations.map(
    (path) => /^supabase\/migrations\/(\d+)_/.exec(path)[1],
  );
  if (
    numbers.some(
      (number) =>
        !required.some(
          (p) =>
            p.kind === "owner-pre" &&
            p.paths.some((path) => path.includes(number)),
        ) ||
        !required.some(
          (p) =>
            p.kind === "owner-post" &&
            p.paths.some((path) => path.includes(number)),
        ),
    )
  ) {
    console.error("OWNER_PROOF_UNMAPPED");
    process.exit(2);
  }
}
const plan = {
  ...impact,
  treeSha: run("rev-parse", `${head}^{tree}`),
  unitProofs: required.filter((p) => p.kind === "unit"),
  postgresProofs: required.filter((p) => p.kind === "postgres"),
  e2eProofs: required.filter((p) => p.kind === "e2e"),
  handoverProofs: required.filter((p) => p.kind === "handover"),
  ownerProofs: required.filter((p) => p.runner === "owner-sql"),
  forbiddenWrites: ["production"],
};
plan.planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
console.log(JSON.stringify(plan, null, 2));
