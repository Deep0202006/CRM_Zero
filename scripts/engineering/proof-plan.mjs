import { resolve } from "node:path";
import { compileImpact } from "./impact.mjs";
import { parseArgs, readJson, sha256 } from "./kernel-lib.mjs";

const kinds = ["unit", "build", "postgres", "e2e", "handover", "owner-pre", "owner-post"];
export const compileProofPlan = ({ base = "origin/main", head = "WORKTREE", impact } = {}) => {
  impact ??= compileImpact({ base, head });
  const domains = readJson("docs/engineering/DOMAIN_MAP.json").domains;
  const proofs = readJson("docs/engineering/PROOFS.json").proofs;
  const mapped = domains.filter((domain) => impact.domains.includes(domain.id));
  const explicit = new Set(mapped.flatMap((domain) => domain.proofRefs ?? []));
  const requiredKinds = new Set(mapped.flatMap((domain) => domain.requiredProofKinds ?? []));
  const required = proofs.filter((proof) => explicit.has(proof.id) || (proof.domains ?? []).some((domain) => impact.domains.includes(domain)) || (proof.effects ?? []).includes("ALL_CHANGES"));
  for (const kind of requiredKinds) if (!required.some((proof) => proof.kind === kind)) throw new Error(`PROOF_UNMAPPED:${kind}`);
  if (impact.risk === "R3" && !required.some((proof) => proof.kind === "unit")) throw new Error("PROOF_UNMAPPED:unit");
  const plan = {
    schemaVersion: 1,
    ...impact,
    requiredProofs: required.map((proof) => proof.id),
    requiredByKind: Object.fromEntries(kinds.map((kind) => [kind, required.filter((proof) => proof.kind === kind).map((proof) => proof.id)])),
    notRequiredKinds: kinds.filter((kind) => !requiredKinds.has(kind) && !required.some((proof) => proof.kind === kind)),
    forbiddenWrites: ["production", ...mapped.flatMap((domain) => domain.mustNotWriteAuthorityRefs ?? [])],
  };
  plan.planHash = sha256(JSON.stringify(plan));
  return plan;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { value } = parseArgs();
  try { console.log(JSON.stringify(compileProofPlan({ base: value("--base", "origin/main"), head: value("--head", "WORKTREE") }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
