import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
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

export type RemoteReleaseFacts = {
  pr:{head:string;base:string;state:string};
  requiredChecks:Array<{name:string;status:string}>;
  vercel:{status:string;head:string};
};

export type RemoteReleaseAuthority = (root:string, task:TaskFile) => RemoteReleaseFacts;

type GitHubCheck = { name?:string;context?:string;bucket?:string;state?:string };
const OWNER_GATE_REQUIRED_CHECKS = ["verify", "receivables-postgres", "e2e"];

export const githubReleaseAuthority:RemoteReleaseAuthority = (root,task) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,".crm-engineering/manifest.json"),"utf8")) as {repository?:string};
  if (!manifest.repository || !task.repository.branch) throw new Error("OWNER_GATE_REMOTE_AUTHORITY_UNCONFIGURED");
  const runGh = (args:string[]) => JSON.parse(execFileSync("gh",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  let pr:any;
  let checks:GitHubCheck[];
  try {
    pr = runGh(["pr","view",task.repository.branch,"--repo",manifest.repository,"--json","headRefOid,baseRefOid,state"]);
    checks = runGh(["pr","checks",task.repository.branch,"--repo",manifest.repository,"--json","name,bucket,state"]);
  } catch {
    throw new Error("OWNER_GATE_REMOTE_AUTHORITY_UNAVAILABLE");
  }
  const vercel = checks.find(check => (check.name ?? check.context ?? "").toLowerCase().includes("vercel"));
  const required = OWNER_GATE_REQUIRED_CHECKS.map(name => {
    const check = checks.find(candidate => (candidate.name ?? candidate.context ?? "") === name);
    return {name,status:check?.bucket ?? check?.state ?? "missing"};
  });
  return {
    pr:{head:pr.headRefOid,base:pr.baseRefOid,state:pr.state},
    requiredChecks:required,
    vercel:{status:vercel?.bucket ?? vercel?.state ?? "",head:pr.headRefOid}
  };
};

function certificationEvidence(root:string, task:TaskFile) {
  const candidates = task.acceptance
    .filter(item => item.required && item.stage === "VERIFICATION" && item.status === "PASS")
    .flatMap(item => item.evidenceIds)
    .filter(id => id.startsWith(".crm-engineering/") && id.endsWith(".json"));
  for (const candidate of candidates) {
    let value:any;
    try {
      value = JSON.parse(git(root,["show",`HEAD:${candidate.replace(/\\/g,"/")}`]));
    } catch { continue; }
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
  const releaseCriticalState = (value:TaskFile) => ({
    flowVersion:value.flowVersion,
    taskId:value.taskId,
    phase:value.phase,
    blocker:value.blocker,
    humanGate:value.humanGate ? {kind:value.humanGate.kind,status:value.humanGate.status} : null,
    repository:{
      expectedBaseSha:value.repository.expectedBaseSha,
      branch:value.repository.branch
    },
    productionDataMutation:value.productionDataMutation,
    schemaChange:value.schemaChange,
    requiredAcceptance:value.acceptance
      .filter(item => item.required)
      .map(item => ({
        id:item.id,
        stage:item.stage,
        required:item.required,
        status:item.status,
        evidenceIds:item.evidenceIds
      }))
  });
  if (committed.humanGate?.kind !== "OWNER_PRODUCTION_GATE" ||
      !isDeepStrictEqual(releaseCriticalState(committed),releaseCriticalState(task))) {
    throw new Error("OWNER_GATE_COMMITTED_TASK_STATE_MISMATCH");
  }
}

function assertMigrationIntegrity(root:string, task:TaskFile, proof:ReleaseCertification) {
  const base = task.repository.expectedBaseSha;
  if (!base) throw new Error("OWNER_GATE_IMMUTABLE_MIGRATION_POLICY_MISMATCH");
  let policy:{immutableThrough:number};
  let migration:Buffer;
  try {
    policy = JSON.parse(git(root,["show",`${base}:.crm-engineering/policy/applied-migrations.json`]));
    migration = execFileSync("git",["-C",root,"show",`HEAD:${proof.migration.path}`],{encoding:null,stdio:["ignore","pipe","pipe"]});
  } catch {
    throw new Error("OWNER_GATE_MIGRATION_NOT_COMMITTED");
  }
  if (proof.immutablePolicy?.immutableThrough !== policy.immutableThrough ||
      !Number.isInteger(proof.migration?.number) || proof.migration.number <= policy.immutableThrough ||
      !new RegExp(`^supabase/migrations/${String(proof.migration.number).padStart(3,"0")}_`).test(proof.migration?.path ?? "")) {
    throw new Error("OWNER_GATE_IMMUTABLE_MIGRATION_POLICY_MISMATCH");
  }
  const digest = crypto.createHash("sha256").update(migration).digest("hex");
  if (digest !== proof.migration.sha256) throw new Error("OWNER_GATE_MIGRATION_HASH_MISMATCH");
  const changed = git(root,["diff","--name-only",task.repository.expectedBaseSha!,"HEAD","--","supabase/migrations"])
    .split(/\r?\n/).filter(Boolean);
  if (changed.some(candidate => {
    const match=candidate.replace(/\\/g,"/").match(/^supabase\/migrations\/(\d+)_/);
    return match && Number(match[1]) <= policy.immutableThrough;
  })) throw new Error("OWNER_GATE_APPLIED_MIGRATION_CHANGED");
}

export function authorizeOwnerMigrationReadiness(root:string, task:TaskFile, remoteAuthority:RemoteReleaseAuthority = githubReleaseAuthority) {
  assertCommittedTask(root,task);
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
  const proof = certificationEvidence(root,task);
  const head = inspectRepo(root).head;
  const remote = remoteAuthority(root,task);
  if (proof.schemaVersion !== 1 || proof.taskId !== task.taskId ||
      proof.repository?.baseSha !== task.repository.expectedBaseSha ||
      remote.pr?.head !== head ||
      remote.pr?.base !== task.repository.expectedBaseSha || remote.pr?.state !== "OPEN") {
    throw new Error("OWNER_GATE_REMOTE_HEAD_MISMATCH");
  }
  if (!Array.isArray(remote.requiredChecks) ||
      OWNER_GATE_REQUIRED_CHECKS.some(name =>
        !remote.requiredChecks.some(check => check.name === name && check.status === "pass")
      )) {
    throw new Error("OWNER_GATE_REQUIRED_CHECKS_NOT_GREEN");
  }
  if (remote.vercel?.status !== "pass" || remote.vercel?.head !== head) {
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
