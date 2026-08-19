import { z } from "zod/v4";

const AgentStallResume = z.object({
  taskId:z.string().min(1),
  threadId:z.string().min(1),
  type:z.literal("AGENT_STALL"),
  input:z.object({
    guidance:z.string().min(1),
    strategy:z.string().min(1).optional()
  }).strict()
}).strict();

const OwnerGateResume = z.object({
  taskId:z.string().min(1),
  threadId:z.string().min(1),
  type:z.literal("OWNER_PRODUCTION_GATE"),
  input:z.object({
    verified:z.boolean(),
    evidenceIds:z.array(z.string().min(1))
  }).strict()
}).strict().superRefine((value,ctx) => {
  if (value.input.verified && value.input.evidenceIds.length === 0) {
    ctx.addIssue({code:"custom",path:["input","evidenceIds"],message:"verified owner resume requires durable evidence IDs"});
  }
});

const ResumeEnvelope = z.union([AgentStallResume,OwnerGateResume]);
export type HumanInterruptType = "AGENT_STALL"|"OWNER_PRODUCTION_GATE";

export function parseResumeEnvelope(value:unknown, taskId:string, expectedType:HumanInterruptType) {
  const parsed = ResumeEnvelope.parse(value);
  if (parsed.taskId !== taskId || parsed.threadId !== taskId) {
    throw new Error(`GRAPH_RESUME_THREAD_MISMATCH: expected taskId and threadId ${taskId}`);
  }
  if (parsed.type !== expectedType) {
    throw new Error(`GRAPH_RESUME_TYPE_MISMATCH: checkpoint expects ${expectedType}, received ${parsed.type}`);
  }
  return parsed.input;
}

export async function pendingHumanInterrupt(graph:any, config:any):Promise<{type:HumanInterruptType;value:any}> {
  const snapshot = await graph.getState(config);
  const interrupts = (snapshot?.tasks ?? []).flatMap((task:any) => task.interrupts ?? []);
  if (interrupts.length !== 1) {
    throw new Error(`GRAPH_RESUME_INTERRUPT_COUNT: expected one pending interrupt, found ${interrupts.length}`);
  }
  const value = interrupts[0]?.value;
  if (value?.type !== "AGENT_STALL" && value?.type !== "OWNER_PRODUCTION_GATE") {
    throw new Error(`GRAPH_RESUME_UNSUPPORTED_INTERRUPT: ${value?.type ?? "unknown"}`);
  }
  return {type:value.type,value};
}

export function resumeFileTemplate(taskId:string, type:HumanInterruptType) {
  return type === "AGENT_STALL"
    ? {taskId,threadId:taskId,type,input:{guidance:"Describe the focused recovery strategy.",strategy:"Optional alternate approach."}}
    : {taskId,threadId:taskId,type,input:{verified:false,evidenceIds:[]}};
}
