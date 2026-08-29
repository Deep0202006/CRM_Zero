import { readFileSync } from "node:fs";
import { z } from "zod";
import { sha256 } from "./kernel-lib.mjs";

const Hex = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.string().datetime({ offset: true });
const Command = z.object({
  attemptIndex: z.number().int().min(1).max(2),
  commandIndex: z.number().int().nonnegative(),
  executable: z.string().min(1),
  args: z.array(z.string()),
  database: z.string().min(1).nullable(),
  expectedCiJob: z.string().min(1),
  commandIdentity: Hex,
  exitCode: z.number().int(),
  stdoutHash: Hex,
  stdoutBytes: z.number().int().nonnegative(),
  stderrHash: Hex,
  stderrBytes: z.number().int().nonnegative(),
  startedAt: Timestamp,
  endedAt: Timestamp,
}).strict();
const Attempt = z.object({
  attemptIndex: z.number().int().min(1).max(2),
  commandPlanHash: Hex,
  startedAt: Timestamp,
  endedAt: Timestamp,
  commands: z.array(Command).min(1),
}).strict();
export const EvidenceSchema = z.object({
  schemaVersion: z.literal(2),
  proofId: z.string().min(1),
  kind: z.enum(["unit", "build", "postgres", "e2e", "handover", "owner-pre", "owner-post"]),
  status: z.enum(["PASS", "FAIL", "FLAKY_DETECTED"]),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  treeSha: z.string().regex(/^[a-f0-9]{40}$/),
  dirtyFingerprint: Hex,
  impactHash: Hex,
  planHash: Hex,
  proofDefinitionHash: Hex,
  runnerIdentity: Hex,
  commandPlanHash: Hex,
  environmentPolicyHash: Hex,
  startedAt: Timestamp,
  endedAt: Timestamp,
  attempts: z.array(Attempt).min(1).max(2),
  provenanceMode: z.enum(["LOCAL", "GITHUB_ACTIONS"]),
  githubRepository: z.string(),
  githubWorkflow: z.string(),
  githubRunId: z.string(),
  githubRunAttempt: z.string(),
  githubJob: z.string(),
  githubEvent: z.string(),
  expectedSourceJob: z.string().min(1),
  evidencePayloadHash: Hex,
}).strict();

export const evidencePayloadHash = (evidence) => {
  const payload = { ...evidence };
  delete payload.evidencePayloadHash;
  return sha256(JSON.stringify(payload, (_, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value));
};
export const readEvidenceFile = (path) => EvidenceSchema.parse(JSON.parse(readFileSync(path, "utf8")));
export const provenanceFromEnvironment = (environment, expectedSourceJob) => environment.CI === "true" && environment.GITHUB_ACTIONS === "true" ? {
  provenanceMode: "GITHUB_ACTIONS",
  githubRepository: environment.GITHUB_REPOSITORY ?? "",
  githubWorkflow: environment.GITHUB_WORKFLOW ?? "",
  githubRunId: environment.GITHUB_RUN_ID ?? "",
  githubRunAttempt: environment.GITHUB_RUN_ATTEMPT ?? "",
  githubJob: environment.GITHUB_JOB ?? "",
  githubEvent: environment.GITHUB_EVENT_NAME ?? "",
  expectedSourceJob,
} : {
  provenanceMode: "LOCAL",
  githubRepository: "",
  githubWorkflow: "",
  githubRunId: "",
  githubRunAttempt: "",
  githubJob: "",
  githubEvent: "",
  expectedSourceJob,
};
