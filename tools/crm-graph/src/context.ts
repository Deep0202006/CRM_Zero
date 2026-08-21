import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { TaskFile } from "./types.js";
import { inspectRepo } from "./git.js";

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

type Knowledge = { authorities:any[]; capabilities:any[]; lessons:any[] };
type WorkerContextPolicy = { maxLessons:number; mandatoryLessonIds:string[] };
export interface WorkerContextProjection {
  packet:string;
  digest:string;
  authorityIds:string[];
  capabilityIds:string[];
  lessonIds:string[];
}

const TOKEN_STOPWORDS = new Set(["and","the","for","with","status","management","system","rule","data","access","authority"]);
function normalized(value:string) {
  return value.normalize("NFKC").toLowerCase().replace(/[_-]+/g," ").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
function tokens(value:string) {
  return new Set(normalized(value).split(/\s+/).filter(token => token.length >= 3 && !TOKEN_STOPWORDS.has(token)));
}
function overlap(left:Set<string>, right:Set<string>) {
  let score = 0;
  for (const token of left) if (right.has(token)) score++;
  return score;
}
function stableById<T extends {id:string}>(items:T[]) { return [...items].sort((a,b) => a.id.localeCompare(b.id)); }
function loadKnowledge(root:string):Knowledge {
  const authorities = readJson<any>(path.join(root,".crm-engineering","knowledge","authority-registry.json")).facts ?? [];
  const capabilities = readJson<any>(path.join(root,".crm-engineering","knowledge","capability-registry.json")).capabilities ?? [];
  const lessons = readJson<any>(path.join(root,".crm-engineering","knowledge","lessons-registry.json")).lessons ?? [];
  return {authorities,capabilities,lessons};
}
function taskTokens(task:TaskFile) {
  return tokens([task.objective,...task.domains].join(" "));
}
function selectAuthorities(task:TaskFile, authorities:any[]) {
  const relevant = taskTokens(task);
  return stableById(authorities.filter(item => overlap(relevant,tokens(JSON.stringify(item))) > 0));
}
function selectCapabilities(task:TaskFile, capabilities:any[], authorities:any[]) {
  const relevant = taskTokens(task);
  const authorityIds = new Set(authorities.map(item => item.id));
  return stableById(capabilities.filter(item =>
    item.authorityRefs?.some((id:string) => authorityIds.has(id)) || overlap(relevant,tokens(JSON.stringify(item))) > 0
  ));
}
function mandatoryLessonApplicable(id:string, task:TaskFile) {
  if (id === "NO_PRODUCTION_DUMMY_DATA") {
    return task.productionDataMutation || task.schemaChange || task.domains.some(domain => /production|auth|receivable|payment|distributor/.test(domain));
  }
  if (id === "GRAPH_LEARNING_CLOSURE_RULE") return task.risk === "R2" || task.risk === "R3" || task.domains.includes("engineering-graph");
  return true;
}
function selectWorkerLessons(task:TaskFile, knowledge:Knowledge, policy:WorkerContextPolicy) {
  const workerLessons = knowledge.lessons.filter(item => item.workerContext !== false);
  const relevant = taskTokens(task);
  const linked = tokens([
    ...knowledge.authorities.map(item => item.id),
    ...knowledge.capabilities.map(item => item.id)
  ].join(" "));
  const mandatoryIds = new Set(policy.mandatoryLessonIds.filter(id => mandatoryLessonApplicable(id,task)));
  const mandatory = stableById(workerLessons.filter(item => mandatoryIds.has(item.id)));
  const ranked = workerLessons
    .filter(item => !mandatoryIds.has(item.id))
    .map(item => {
      const domainText = normalized(item.domain ?? "");
      const exactDomain = task.domains.some(domain => {
        const taskDomain = normalized(domain);
        return domainText === taskDomain || domainText.includes(taskDomain) || taskDomain.includes(domainText);
      });
      const itemTokens = tokens(JSON.stringify(item));
      return {item, exactDomain, domainScore:overlap(relevant,itemTokens), linkScore:overlap(linked,itemTokens)};
    })
    .filter(candidate => candidate.exactDomain || candidate.domainScore > 0 || candidate.linkScore > 0)
    .sort((a,b) => Number(b.exactDomain)-Number(a.exactDomain) || b.domainScore-a.domainScore || b.linkScore-a.linkScore || a.item.id.localeCompare(b.item.id));
  const available = Math.max(0,policy.maxLessons-mandatory.length);
  return [...ranked.slice(0,available).map(candidate => candidate.item),...mandatory].slice(0,policy.maxLessons);
}

export function compileWorkerContext(root:string, task:TaskFile):WorkerContextProjection {
  if (!task.repository.worktreePath) throw new Error("Task has no worktreePath. Repository recovery is required.");
  const knowledge = loadKnowledge(root);
  const policyRoot = readJson<any>(path.join(root,".crm-engineering","policy","context-policy.json"));
  const policy:WorkerContextPolicy = {
    maxLessons:Math.max(1,policyRoot.workerContext?.maxLessons ?? 14),
    mandatoryLessonIds:policyRoot.workerContext?.mandatoryLessonIds ?? []
  };
  const authorities = selectAuthorities(task,knowledge.authorities);
  const capabilities = selectCapabilities(task,knowledge.capabilities,authorities);
  const lessons = selectWorkerLessons(task,{authorities,capabilities,lessons:knowledge.lessons},policy);
  const packet = [
    "# CRM GRAPH WORKER CONTEXT",
    `TASK: ${task.taskId}`,
    `OBJECTIVE: ${task.objective}`,
    `RISK: ${task.risk}`,
    `WORKTREE: ${task.repository.worktreePath}`,
    `BRANCH: ${task.repository.branch ?? "DETACHED"}`,
    `EXPECTED BASE: ${task.repository.expectedBaseSha ?? task.repository.expectedBaseRef}`,
    "",
    "## Domains",...task.domains.map(item => `- ${item}`),
    "",
    "## Allowed paths",...task.allowedPaths.map(item => `- ${item}`),
    "",
    "## Protected paths/domains",...task.protectedDomains.map(item => `- ${item}`),
    "",
    "## Canonical authorities",...authorities.map(item => `- ${item.id}: ${item.authority}`),
    "",
    "## Reusable capabilities",...capabilities.map(item => `- ${item.id}: ${item.status}`),
    "",
    "## Applicable lessons",...lessons.map(item => `- ${item.id}: ${item.rule}`),
    "",
    "## Controller contract",
    "- The focused acceptance in this turn is the only work slice.",
    "- Stay inside allowed paths and preserve protected domains.",
    "- Never use legacy docs/os or .harness as workflow authority.",
    "- Never contact production systems.",
    "- Return the structured worker result; the controller owns phase, completion, release, and BLOCKED state."
  ].join("\n");
  return {
    packet,
    digest:createHash("sha256").update(packet,"utf8").digest("hex"),
    authorityIds:authorities.map(item => item.id),
    capabilityIds:capabilities.map(item => item.id),
    lessonIds:lessons.map(item => item.id)
  };
}

export function compileContext(root: string, task: TaskFile) {
  const wt = task.repository.worktreePath;
  if (!wt) throw new Error("Task has no worktreePath. Repository recovery is required.");

  const repo = inspectRepo(wt);
  const authorities = readJson<any>(path.join(root, ".crm-engineering","knowledge","authority-registry.json"));
  const capabilities = readJson<any>(path.join(root, ".crm-engineering","knowledge","capability-registry.json"));
  const lessons = readJson<any>(path.join(root, ".crm-engineering","knowledge","lessons-registry.json"));

  const selectedAuthorities = authorities.facts.filter((x: any) =>
    task.domains.some(d =>
      JSON.stringify(x).toLowerCase().includes(d.replace(/-/g," ").toLowerCase()) ||
      JSON.stringify(x).toLowerCase().includes(d.replace(/-/g,"_").toLowerCase())
    )
  );

  const selectedCapabilities = capabilities.capabilities.filter((x: any) =>
    x.authorityRefs?.some((r: string) =>
      selectedAuthorities.some((a: any) => a.id === r)
    ) || task.domains.some(d => JSON.stringify(x).toLowerCase().includes(d.split("-")[0]))
  );

  const selectedLessons = lessons.lessons.filter((x: any) =>
    task.domains.some(d => JSON.stringify(x).toLowerCase().includes(d.split("-")[0])) ||
    ["Execution management","Worktree authority","Production safety"].includes(x.domain)
  );

  const remaining = task.acceptance.filter(a => a.required && a.status !== "PASS");

  return [
    "# CRM GRAPH CONTEXT PACKET",
    `TASK: ${task.taskId}`,
    `OBJECTIVE: ${task.objective}`,
    `PHASE: ${task.phase}`,
    `RISK: ${task.risk}`,
    `WORKTREE: ${wt}`,
    `BRANCH: ${repo.branch ?? "DETACHED"}`,
    `HEAD: ${repo.head}`,
    `EXPECTED BASE: ${task.repository.expectedBaseSha ?? task.repository.expectedBaseRef}`,
    "",
    "## Domains",
    ...task.domains.map(x => `- ${x}`),
    "",
    "## Allowed paths",
    ...task.allowedPaths.map(x => `- ${x}`),
    "",
    "## Protected domains",
    ...task.protectedDomains.map(x => `- ${x}`),
    "",
    "## Selected authorities",
    ...selectedAuthorities.map((x:any) => `- ${x.id}: ${x.authority}`),
    "",
    "## Reusable capabilities",
    ...selectedCapabilities.map((x:any) => `- ${x.id}: ${x.status}`),
    "",
    "## Binding lessons",
    ...selectedLessons.map((x:any) => `- ${x.id}: ${x.rule}`),
    "",
    "## Required acceptance remaining",
    ...remaining.map(x => `- ${x.id} [${x.stage}] ${x.description}`),
    "",
    "## Controller contract",
    "- Do not read docs/os or .harness for workflow.",
    "- Do not broaden scope.",
    "- Implementation incomplete is not BLOCKED.",
    "- Broad verification is illegal until implementation acceptance is complete.",
    "- Return structured worker result; controller owns next state."
  ].join("\n");
}

export function writeContextProjection(root: string, task: TaskFile) {
  const packet = compileContext(root, task);
  const p = path.join(root, "CRM_CONTEXT.md");
  fs.writeFileSync(
    p,
    [
      "# CRM_Zero Current Engineering Context",
      "",
      "> Generated by CRM Engineering Graph. Do not hand-edit task state here.",
      "",
      packet
    ].join("\n"),
    "utf8"
  );
  return p;
}
