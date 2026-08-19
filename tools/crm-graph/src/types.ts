export type Risk = "R0" | "R1" | "R2" | "R3";
export type Stage = "IMPLEMENTATION" | "VERIFICATION" | "RELEASE";
export type AcceptanceStatus = "PENDING" | "PASS" | "FAIL" | "BLOCKED" | "INVALIDATED";
export type Phase =
  | "REPOSITORY_RECOVERY" | "DISCOVERY" | "IMPLEMENTATION"
  | "STATIC_VERIFICATION" | "TARGETED_VERIFICATION" | "REVIEW"
  | "RELEASE" | "PRODUCTION_GATE" | "CERTIFICATION" | "COMPLETE";

export type BlockerType =
  | "TRANSIENT_TOOL_FAILURE"
  | "IMPLEMENTATION_INCOMPLETE"
  | "AGENT_STALLED"
  | "VERIFICATION_FAILURE"
  | "ENVIRONMENT_DRIFT"
  | "EXTERNAL_DEPENDENCY"
  | "HUMAN_APPROVAL_REQUIRED"
  | "SAFETY_VIOLATION"
  | "UNEXPECTED_SYSTEM_ERROR";

export interface AcceptanceItem {
  id: string;
  description: string;
  stage: Stage;
  status: AcceptanceStatus;
  required: boolean;
  evidenceIds: string[];
}

export interface TaskFile {
  schemaVersion: 2;
  graphSchemaVersion: number;
  flowVersion: string;
  taskId: string;
  objective: string;
  risk: Risk;
  domains: string[];
  repository: {
    canonicalRoot: string;
    worktreePath: string | null;
    branch: string | null;
    expectedBaseRef: string;
    expectedBaseSha: string | null;
    observedHeadSha: string | null;
    dirtyBaselineHash: string | null;
  };
  phase: Phase;
  allowedPaths: string[];
  protectedDomains: string[];
  productionDataMutation: boolean;
  schemaChange: boolean;
  humanGate: null | { kind: string; status: string; reason: string };
  acceptance: AcceptanceItem[];
  blocker: null | { type: BlockerType; external: boolean; reason: string; evidenceIds?: string[] };
}
