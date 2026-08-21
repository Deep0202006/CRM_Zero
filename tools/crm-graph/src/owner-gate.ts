import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TaskFile } from "./types.js";
import { git, inspectRepo } from "./git.js";

export const OWNER_MIGRATION_READINESS_PHRASE =
  "OWNER_MIGRATION_READY: Owner may manually apply the reviewed production SQL.";

type ReleaseCertification = {
  schemaVersion:number;
  kind:string;
  taskId:string;
  repository:{remotePrHead:string;certifiedHead:string;baseSha:string};
  requiredChecks:Array<{name:string;status:string}>;
  vercel:{status:string;head:string};
  migration:{path:string;number:number;sha256:string};
  immutablePolicy:{immutableThrough:number};
};

function certificationEvidence(root:string, task:TaskFile) {
  const candidates = task.acceptance
    .filter(item => item.required && item.stage === "VERIFICATION" && item.status === "PASS")
    .flatMap(item => item.evidenceIds)
    .filter(id => id.startsWith(".crm-engineering/") && id.endsWith(".json"));
  for (const candidate of candidates) {
    const absolute = path.join(root,candidate);
    if (!fs.existsSync(absolute)) continue;
    const value = JSON.parse(fs.readFileSync(absolute,"utf8"));
    if (value?.kind === "OWNER_MIGRATION_READINESS_CERTIFICATION") {
      return value as ReleaseCertification;
    }
  }
  throw new Error("OWNER_GATE_CERTIFICATION_MISSING");
}

function assertCommittedTask(root:string, task:TaskFile) {
  const relative = `.crm-engineering/tasks/${task.taskId}.json`;
  let committed:TaskFile;
  try {
    committed = JSON.parse(git(root,["show",`HEAD:${relative}`])) as TaskFile;
  } catch {
    throw new Error("OWNER_GATE_TASK_NOT_COMMITTED");
  }
  if (committed.taskId !== task.taskId || committed.humanGate?.kind !== "OWNER_PRODUCTION_GATE" ||
      committed.repository.expectedBaseSha !== task.repository.expectedBaseSha ||
      committed.acceptance.map(item=>item.id).join("\0") !== task.acceptance.map(item=>item.id).join("\0")) {
    throw new Error("OWNER_GATE_COMMITTED_TASK_MISMATCH");
  }
}

function assertMigrationIntegrity(root:string, task:TaskFile, proof:ReleaseCertification) {
  const policy = JSON.parse(fs.readFileSync(path.join(root,".crm-engineering/policy/applied-migrations.json"),"utf8")) as {immutableThrough:number};
  if (proof.immutablePolicy?.immutableThrough !== policy.immutableThrough ||
      !Number.isInteger(proof.migration?.number) || proof.migration.number <= policy.immutableThrough ||
      !new RegExp(`^supabase/migrations/${String(proof.migration.number).padStart(3,"0")}_`).test(proof.migration?.path ?? "")) {
    throw new Error("OWNER_GATE_IMMUTABLE_MIGRATION_POLICY_MISMATCH");
  }
  const migrationPath = path.join(root,proof.migration.path);
  if (!fs.existsSync(migrationPath)) throw new Error("OWNER_GATE_MIGRATION_MISSING");
  try {
    git(root,["cat-file","-e",`HEAD:${proof.migration.path}`]);
    git(root,["diff","--quiet","HEAD","--",proof.migration.path]);
  } catch {
    throw new Error("OWNER_GATE_MIGRATION_NOT_COMMITTED");
  }
  const digest = crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");
  if (digest !== proof.migration.sha256) throw new Error("OWNER_GATE_MIGRATION_HASH_MISMATCH");
  const changed = git(root,["diff","--name-only",task.repository.expectedBaseSha!,"HEAD","--","supabase/migrations"])
    .split(/\r?\n/).filter(Boolean);
  if (changed.some(candidate => {
    const match=candidate.replace(/\\/g,"/").match(/^supabase\/migrations\/(\d+)_/);
    return match && Number(match[1]) <= policy.immutableThrough;
  })) throw new Error("OWNER_GATE_APPLIED_MIGRATION_CHANGED");
}

export function authorizeOwnerMigrationReadiness(root:string, task:TaskFile) {
  const preReleaseComplete = task.acceptance
    .filter(item => item.required && item.stage !== "RELEASE")
    .every(item => item.status === "PASS");
  const releasePending = task.acceptance.some(
    item => item.required && item.stage === "RELEASE" && item.status !== "PASS"
  );
  const ownerGatePending = task.humanGate?.kind === "OWNER_PRODUCTION_GATE" &&
    task.humanGate.status === "PENDING";

  if (!preReleaseComplete || !releasePending || !ownerGatePending) {
    throw new Error("OWNER_MIGRATION_READINESS_UNAUTHORIZED");
  }
  assertCommittedTask(root,task);
  const proof = certificationEvidence(root,task);
  const head = inspectRepo(root).head;
  if (proof.schemaVersion !== 1 || proof.taskId !== task.taskId ||
      proof.repository?.baseSha !== task.repository.expectedBaseSha ||
      proof.repository?.remotePrHead !== head || proof.repository?.certifiedHead !== head) {
    throw new Error("OWNER_GATE_REMOTE_HEAD_MISMATCH");
  }
  if (!Array.isArray(proof.requiredChecks) || proof.requiredChecks.length === 0 ||
      proof.requiredChecks.some(check => !check.name || check.status !== "PASS")) {
    throw new Error("OWNER_GATE_REQUIRED_CHECKS_NOT_GREEN");
  }
  if (proof.vercel?.status !== "READY" || proof.vercel?.head !== head) {
    throw new Error("OWNER_GATE_VERCEL_NOT_READY");
  }
  assertMigrationIntegrity(root,task,proof);
  return OWNER_MIGRATION_READINESS_PHRASE;
}

export function rejectWorkerOwnerMigrationReadiness(value:unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized.includes(OWNER_MIGRATION_READINESS_PHRASE)) {
    throw new Error("CODEX_WORKER_OWNER_MIGRATION_READINESS_FORBIDDEN");
  }
}
