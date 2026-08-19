import { SqliteSaver } from "../../../tools/crm-graph/node_modules/@langchain/langgraph-checkpoint-sqlite/dist/index.js";

const taskId = "CRM-GRAPH-ENFORCE-CERT-V2";
const databasePath = ".crm-engineering/runtime/engineering-state.sqlite";
const saver = SqliteSaver.fromConnString(databasePath);
const tuple = await saver.getTuple({ configurable: { thread_id: taskId } });

if (!tuple) throw new Error(`No SQLite checkpoint exists for ${taskId}`);

const state = tuple.checkpoint?.channel_values ?? {};
const acceptance = Array.isArray(state.acceptance) ? state.acceptance : [];
const summary = {
  taskId,
  databasePath,
  hasCheckpoint: true,
  checkpointId: tuple.config?.configurable?.checkpoint_id ?? null,
  checkpointCreatedAt: tuple.checkpoint?.ts ?? null,
  graphStep: tuple.metadata?.step ?? null,
  graphSource: tuple.metadata?.source ?? null,
  currentNode: state.currentNode ?? null,
  phase: state.phase ?? null,
  nextLegalAction: state.nextLegalAction ?? null,
  workerIntent: state.workerIntent ?? null,
  workerRetryMode: state.workerRetryMode ?? null,
  workerFailureCount: state.workerFailureCount ?? 0,
  lastWorkerError: state.lastWorkerError ?? null,
  focusedAcceptanceId: state.focusedAcceptanceId ?? null,
  codexThreadId: state.codexThreadId ?? null,
  codexResultValid: state.codexResultValid ?? false,
  beforePassCount: state.beforePassCount ?? null,
  afterPassCount: state.afterPassCount ?? null,
  implementationAcceptance: acceptance.find((item) => item.id === "GRAPH-ENFORCE-V2-A01") ?? null,
  verificationAcceptance: acceptance.find((item) => item.id === "GRAPH-ENFORCE-V2-V01") ?? null,
  beforeChangedPaths: state.beforeChangedPaths ?? [],
  pendingWrites: tuple.pendingWrites?.length ?? 0,
  pendingInterrupts: tuple.pendingWrites?.filter((write) => write[1] === "__interrupt__").length ?? 0
};

console.log(JSON.stringify(summary, null, 2));
