import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileImpact } from "./impact.mjs";
import { compileProofPlan, proofKinds } from "./proof-plan.mjs";
import { canonicalEvidencePath } from "./proof-runner.mjs";
import { readEvidenceFile } from "./proof-evidence.mjs";
import { readSessionState } from "./hooks/state-store.mjs";
import { git, parseArgs, readJson, repositoryIdentity, sha256, validateMigrationLedger } from "./kernel-lib.mjs";
import { readIncidentRegistry, readPrepushCertificate } from "./experience.mjs";
import { findActiveTask, taskDirectory } from "./task-state.mjs";

export const kernelStatus = ({ session = "unknown" } = {}) => {
  const identity = repositoryIdentity(), repository = { ...identity, branch: git("branch", "--show-current"), dirty: identity.dirtyFingerprint !== sha256("") }, task = findActiveTask(), ledger = validateMigrationLedger(readJson("supabase/migrations/APPLIED_OWNER_MIGRATIONS.json"));
  let impact = null, plan = null, planError = null;
  try { impact = compileImpact({ base: "origin/main", head: repository.dirty ? "WORKTREE" : "HEAD" }); plan = compileProofPlan({ impact }); } catch (error) { planError = error.message; }
  const proofReceipts = plan ? plan.requiredProofs.map((proofId) => { try { const evidence = readEvidenceFile(canonicalEvidencePath(proofId)); return { proofId, status: evidence.headSha === repository.headSha ? evidence.status : "MISSING", evidenceHash: evidence.headSha === repository.headSha ? evidence.evidencePayloadHash : null }; } catch { return { proofId, status: "MISSING", evidenceHash: null }; } }) : [];
  for (const kind of proofKinds.filter((kind) => !(plan?.requiredByKind[kind] ?? []).length)) proofReceipts.push({ kind, status: "NOT_REQUIRED" });
  const certificate = task ? readPrepushCertificate(task.taskId) : null, deliveryPath = task ? resolve(taskDirectory(task.taskId), "delivery.json") : null, delivery = deliveryPath && existsSync(deliveryPath) ? JSON.parse(readFileSync(deliveryPath, "utf8")) : null;
  return { schemaVersion: 2, repository, activeTask: task ? { id: task.taskId, status: task.status, phase: task.status, risk: impact?.risk ?? null } : null, context: { status: impact?.writable ? "RESOLVED" : "BLOCKED", risk: impact?.risk ?? null, error: planError }, proofPlanHash: plan?.planHash ?? null, proofReceipts, prepushCertificate: !certificate ? "MISSING" : certificate.status === "READY" && certificate.headSha === repository.headSha ? "READY" : "STALE", migrationLedger: { immutableThrough: ledger.immutableThrough, lastApplied: ledger.lastAppliedOwnerMigration, nextLegalMigration: ledger.immutableThrough + 1 }, ownerGate: delivery?.status ?? "NONE", unresolvedIncidents: readIncidentRegistry().incidents.filter((incident) => incident.status === "OBSERVED").map((incident) => incident.fingerprint), release: delivery, session: readSessionState(session) };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) console.log(JSON.stringify(kernelStatus({ session: parseArgs().value("--session", "unknown") }), null, 2));
