import { StateSchema } from "@langchain/langgraph";
import { z } from "zod/v4";

const Acceptance = z.object({
  id: z.string(),
  description: z.string(),
  stage: z.enum(["IMPLEMENTATION", "VERIFICATION", "RELEASE"]),
  status: z.enum(["PENDING", "PASS", "FAIL", "BLOCKED", "INVALIDATED"]),
  required: z.boolean(),
  evidenceIds: z.array(z.string()).default([])
});

const Blocker = z.object({
  type: z.enum([
    "TRANSIENT_TOOL_FAILURE",
    "IMPLEMENTATION_INCOMPLETE",
    "AGENT_STALLED",
    "VERIFICATION_FAILURE",
    "ENVIRONMENT_DRIFT",
    "EXTERNAL_DEPENDENCY",
    "HUMAN_APPROVAL_REQUIRED",
    "SAFETY_VIOLATION",
    "UNEXPECTED_SYSTEM_ERROR"
  ]),
  external: z.boolean(),
  reason: z.string(),
  evidenceIds: z.array(z.string()).default([])
}).nullable();

const WorkerError = z.object({
  code:z.string(),
  message:z.string(),
  stderrTail:z.string().optional(),
  attempt:z.number().int().positive(),
  occurredAt:z.string()
});

export const EngineeringState = new StateSchema({
  graphSchemaVersion: z.number().int().default(1),
  flowVersion: z.string().default("1.0.0"),
  taskId: z.string(),
  objective: z.string(),
  mode: z.enum(["shadow", "enforce"]).default("shadow"),

  canonicalRoot: z.string(),
  graphRoot: z.string(),
  worktreePath: z.string(),
  branch: z.string().nullable().default(null),
  expectedBaseRef: z.string().default("origin/main"),
  expectedBaseSha: z.string().nullable().default(null),
  observedHeadSha: z.string().nullable().default(null),
  dirtyBaselineHash: z.string().nullable().default(null),

  risk: z.enum(["R0","R1","R2","R3"]),
  domains: z.array(z.string()).default([]),
  allowedPaths: z.array(z.string()).default([]),
  protectedDomains: z.array(z.string()).default([]),
  phase: z.enum([
    "REPOSITORY_RECOVERY","DISCOVERY","IMPLEMENTATION",
    "STATIC_VERIFICATION","TARGETED_VERIFICATION","REVIEW",
    "RELEASE","PRODUCTION_GATE","CERTIFICATION","COMPLETE"
  ]),

  acceptance: z.array(Acceptance).default([]),
  blocker: Blocker.default(null),

  currentNode: z.string().default("START"),
  nextLegalAction: z.string().default(""),
  contextPacket: z.string().default(""),

  repoHealthy: z.boolean().default(false),
  implementationComplete: z.boolean().default(false),
  broadVerificationAllowed: z.boolean().default(false),
  canEnd: z.boolean().default(false),

  beforeDiffHash: z.string().nullable().default(null),
  beforeChangedPaths: z.array(z.string()).default([]),
  afterDiffHash: z.string().nullable().default(null),
  beforePassCount: z.number().int().default(0),
  afterPassCount: z.number().int().default(0),
  stallCount: z.number().int().default(0),
  workerIntent: z.enum(["IMPLEMENT","VERIFY"]).default("IMPLEMENT"),
  focusedAcceptanceId: z.string().nullable().default(null),
  workerRetryMode: z.enum(["INITIAL","FOCUSED_RETRY","STRATEGY_CHANGE","ESCALATE"]).default("INITIAL"),
  workerFailureCount: z.number().int().nonnegative().default(0),
  workerErrorHistory: z.array(WorkerError).default([]),
  workerStrategyGuidance: z.string().nullable().default(null),

  codexThreadId: z.string().nullable().default(null),
  codexLastMessage: z.string().default(""),
  codexResultValid: z.boolean().default(false),
  lastWorkerError: WorkerError.nullable().default(null),

  findings: z.array(z.string()).default([])
});

export type EngineeringStateType = typeof EngineeringState.State;
