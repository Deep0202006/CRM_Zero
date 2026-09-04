import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { git, parseArgs, readJson, repositoryIdentity, root, sha256 } from "./kernel-lib.mjs";
import { findActiveTask, taskDirectory } from "./task-state.mjs";

export const EXPERIENCE_PACKET_MAX_BYTES = 2400;
const incidentStatuses = new Set(["OBSERVED", "VERIFIED", "SUPERSEDED"]);

const atomicWrite = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  renameSync(temporary, path);
};

export const experienceRoot = () => resolve(git("rev-parse", "--path-format=absolute", "--git-common-dir"), "zd-os/experience");
export const incidentRegistryPath = () => resolve(experienceRoot(), "incidents.json");
export const taskExperiencePath = (taskId) => resolve(taskDirectory(taskId), "experience.json");
export const prepushCertificatePath = (taskId) => resolve(taskDirectory(taskId), "prepush.json");
const readJsonIfPresent = (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;

export const normalizeFailureSignature = (value) => String(value ?? "")
  .replace(/[A-Za-z]:[\\/][^\r\n"']+/g, "<path>")
  .replace(/\b[0-9a-f]{7,64}\b/gi, "<sha>")
  .replace(/\b\d{4}-\d\d-\d\d[T ][0-9:.+-]+Z?\b/g, "<time>")
  .replace(/\b(?:kernel|test|tmp)_[a-z0-9_]+\b/gi, "<db>")
  .replace(/:\d+(?::\d+)?\b/g, ":<line>")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 512);

export const readIncidentRegistry = () => readJsonIfPresent(incidentRegistryPath(), { schemaVersion: 1, incidents: [] });
export const readTaskExperience = (taskId) => readJsonIfPresent(taskExperiencePath(taskId), { schemaVersion: 1, task: taskId, assumptions: [], incidents: [], metrics: {} });
export const writeTaskExperience = (taskId, value) => (atomicWrite(taskExperiencePath(taskId), value), value);
export const updateTaskMetrics = (taskId, transform) => {
  const current = readTaskExperience(taskId), metrics = typeof transform === "function" ? transform(current.metrics ?? {}) : { ...(current.metrics ?? {}), ...transform };
  return writeTaskExperience(taskId, { ...current, metrics });
};

export const validateIncident = (incident) => {
  if (!incident?.fingerprint || !incidentStatuses.has(incident.status) || !Number.isInteger(incident.occurrences) || incident.occurrences < 1) throw new Error("INCIDENT_INVALID");
  if (incident.status === "VERIFIED" && (!(incident.evidenceRefs?.length) || !incident.rootCause || !incident.correctionPrinciple || !(incident.regressionRefs?.length) || incident.regressionPassed !== true)) throw new Error("INCIDENT_VERIFICATION_INCOMPLETE");
  return incident;
};

export const upsertIncident = (incident, { registry = readIncidentRegistry(), persist = true } = {}) => {
  validateIncident(incident);
  const incidents = [...(registry.incidents ?? [])], index = incidents.findIndex((item) => item.fingerprint === incident.fingerprint);
  if (index < 0) incidents.push(incident);
  else {
    const current = validateIncident(incidents[index]);
    if (incident.status === "SUPERSEDED" && !incident.supersession?.evidenceRefs?.length) throw new Error("INCIDENT_SUPERSESSION_EVIDENCE_REQUIRED");
    if (["VERIFIED", "SUPERSEDED"].includes(current.status) && incident.status === "OBSERVED") incidents[index] = {
      ...current,
      occurrences: current.occurrences + 1,
      lastSeen: incident.lastSeen ?? new Date().toISOString(),
      evidenceRefs: [...new Set([...(current.evidenceRefs ?? []), ...(incident.evidenceRefs ?? [])])].slice(-20),
    };
    else incidents[index] = { ...current, ...incident, occurrences: Math.max(current.occurrences, incident.occurrences), evidenceRefs: [...new Set([...(current.evidenceRefs ?? []), ...(incident.evidenceRefs ?? [])])].slice(-20) };
  }
  incidents.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const next = { schemaVersion: 1, incidents };
  if (persist) atomicWrite(incidentRegistryPath(), next);
  return next;
};

export const recordFailure = ({ taskId, signature, evidenceRefs = [], domains = [], pathHints = [], proofKinds = [], environment = {} }) => {
  const normalized = normalizeFailureSignature(signature), fingerprint = sha256(normalized || "unknown-failure"), task = readTaskExperience(taskId), existing = (task.incidents ?? []).find((item) => item.fingerprint === fingerprint), canonical = (readIncidentRegistry().incidents ?? []).find((item) => item.fingerprint === fingerprint);
  const incident = validateIncident({
    fingerprint,
    status: "OBSERVED",
    task: taskId,
    domains: [...new Set(domains)].sort(),
    pathHints: [...new Set(pathHints)].sort(),
    proofKinds: [...new Set(proofKinds)].sort(),
    environment,
    occurrences: (existing?.occurrences ?? 0) + 1,
    evidenceRefs: [...new Set([...(existing?.evidenceRefs ?? []), ...evidenceRefs])].slice(0, 20),
    failureSignature: normalized,
    invalidatedAssumption: existing?.invalidatedAssumption ?? null,
    rootCause: existing?.rootCause ?? null,
    incompleteCorrection: existing?.incompleteCorrection ?? null,
    correctionPrinciple: existing?.correctionPrinciple ?? null,
    sweepEvidence: existing?.sweepEvidence ?? [],
    regressionRefs: existing?.regressionRefs ?? [],
    regressionPassed: existing?.regressionPassed ?? false,
    confidence: existing?.confidence ?? "CANDIDATE",
    supersession: existing?.supersession ?? null,
    canonicalStatus: canonical?.status ?? null,
    lastSeen: new Date().toISOString(),
  });
  const incidents = [...(task.incidents ?? []).filter((item) => item.fingerprint !== fingerprint), incident].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  writeTaskExperience(taskId, { ...task, incidents });
  upsertIncident(incident);
  return incident;
};

export const repeatedFailureBlockers = (incidents) => (incidents ?? []).filter((incident) => incident.occurrences > 1 && (!incident.rootCause || !incident.incompleteCorrection || !incident.sweepEvidence?.length || !incident.regressionRefs?.length || incident.regressionPassed !== true));

const words = (value) => new Set(String(value ?? "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const overlaps = (left, right) => [...left].some((value) => right.has(value));
const boundedPacket = (items, budget) => {
  const selected = [];
  for (const item of items) {
    const next = [...selected, item];
    if (Buffer.byteLength(JSON.stringify(next)) > budget) break;
    selected.push(item);
  }
  return selected;
};

// Codex 0.152.1 spills additionalContext above 2,500 approximate tokens at
// four bytes/token. Staying below 9,000 bytes leaves deterministic headroom.
export const SESSION_CONTEXT_MAX_BYTES = 9_000;
const sessionSecretPattern = /"(?:password|secret|token|api[_-]?key|authorization|cookie)"\s*:|(?:sk|gh[oparsu])_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/i;
export const serializeSessionContext = (payload = {}, budget = SESSION_CONTEXT_MAX_BYTES, pointer = null) => {
  const serialized = JSON.stringify(payload);
  if (sessionSecretPattern.test(serialized)) throw new Error("SESSION_CONTEXT_SENSITIVE_DATA");
  const byteCount = Buffer.byteLength(serialized); if (byteCount <= budget) return serialized;
  if (!pointer) throw new Error(`SESSION_CONTEXT_POINTER_REQUIRED:${byteCount}:${budget}`);
  const compact = JSON.stringify({ kernel: payload.kernel ?? "V6A", boundTaskId: pointer.taskId, sessionStatus: "CONTEXT_REREAD_REQUIRED", contextPointer: pointer, reread: "npm run crm:session:reread", completionClaim: false });
  if (Buffer.byteLength(compact) > budget) throw new Error(`SESSION_CONTEXT_POINTER_BUDGET_EXCEEDED:${Buffer.byteLength(compact)}:${budget}`);
  return compact;
};

export const selectExperience = ({ task = "", domains = [], risk = "R0", candidatePaths = [], requiredProofIds = [], requiredProofKinds = [], environment = {}, failureSignatures = [] } = {}, { lessons = readJson("docs/engineering/LESSONS.json").lessons, incidents = readIncidentRegistry().incidents, budget = EXPERIENCE_PACKET_MAX_BYTES } = {}) => {
  const taskWords = words(task), domainSet = new Set(domains), pathSet = new Set(candidatePaths.map((item) => item.path ?? item)), proofIdSet = new Set(requiredProofIds), proofKindSet = new Set(requiredProofKinds), environmentWords = words(JSON.stringify(environment)), failureWords = words(failureSignatures.join(" "));
  const lessonRows = lessons.map((lesson) => {
    const lessonWords = words([lesson.id, lesson.rule, ...(lesson.triggers ?? [])].join(" "));
    const domainHit = lesson.domains?.includes("all") || lesson.domains?.some((domain) => domainSet.has(domain));
    const triggerHit = (lesson.triggers ?? []).some((trigger) => [...words(trigger)].every((word) => taskWords.has(word)));
    const score = (domainHit ? 5 : 0) + (triggerHit ? 8 : overlaps(taskWords, lessonWords) ? 4 : 0) + (lesson.risk?.includes(risk) ? 1 : 0) + (lesson.loadByDefault ? 1 : 0);
    return { score, id: lesson.id, rule: lesson.rule, whyRelevantNow: domainHit ? `domain:${domains.join(",") || "all"}` : "task trigger", failureClass: lesson.triggers?.[0] ?? lesson.id.toLowerCase(), requiredPreventionAction: lesson.enforcementRefs?.length ? `Run ${lesson.enforcementRefs[0]}` : lesson.rule };
  });
  const incidentRows = (incidents ?? []).filter((incident) => incident.status === "VERIFIED").map((incident) => {
    const domainHit = incident.domains?.some((domain) => domainSet.has(domain)), pathHit = incident.pathHints?.some((path) => pathSet.has(path)), proofKindHit = incident.proofKinds?.some((kind) => proofKindSet.has(kind)), proofIdHit = incident.proofIds?.some((id) => proofIdSet.has(id)), proofHit = proofKindHit || proofIdHit, environmentHit = overlaps(environmentWords, words(JSON.stringify(incident.environment))), failureHit = overlaps(failureWords, words(incident.failureSignature));
    return { score: (domainHit ? 5 : 0) + (pathHit ? 4 : 0) + (proofHit ? 3 : 0) + (environmentHit ? 2 : 0) + (failureHit ? 6 : 0) + Math.min(incident.occurrences ?? 1, 3), id: `INCIDENT:${incident.fingerprint.slice(0, 12)}`, rule: incident.correctionPrinciple, whyRelevantNow: [domainHit && "domain", pathHit && "path", proofHit && "proof", environmentHit && "environment", failureHit && "failure"].filter(Boolean).join(","), failureClass: incident.failureSignature, requiredPreventionAction: incident.correctionPrinciple };
  });
  return boundedPacket([...lessonRows, ...incidentRows].filter((item) => item.score >= 4).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 8).map(({ score: _score, ...item }) => ({ ...item, rule: String(item.rule).slice(0, 150), whyRelevantNow: String(item.whyRelevantNow).slice(0, 80), failureClass: String(item.failureClass).slice(0, 80), requiredPreventionAction: String(item.requiredPreventionAction).slice(0, 70) })), budget);
};

export const deriveAssumptions = ({ risk = "R0", identity, effects = [], domains = [], changedPaths = [], changedAuthorities = [], operations = [], requiredProofs = [] } = {}) => {
  if (!["R2", "R3"].includes(risk)) return [];
  const normalized = requiredProofs.map((item) => typeof item === "string" ? { id: item } : item), ids = normalized.map((item) => item.id), kinds = [...new Set(normalized.map((item) => item.kind).filter(Boolean))], scope = { domains, paths: changedPaths, authorities: changedAuthorities }, make = (className, claim, allowedEvidenceKinds = [], allowedEvidenceProofIds = ids) => ({ id: sha256(JSON.stringify([className, scope])).slice(0, 16), class: className, claim, ...scope, allowedEvidenceProofIds, allowedEvidenceKinds, evidenceHash: null, status: "UNPROVEN" });
  const rows = [
    { ...make("current_git_identity", "Branch, HEAD, base, and dirty state are current.", [], []), evidence: identity, evidenceHash: identity ? sha256(JSON.stringify(identity)) : null, status: identity ? "PROVEN" : "UNPROVEN" },
    { ...make("filesystem_root", "CRM-managed state resolves below the current Git root.", [], []), evidence: root, evidenceHash: sha256(root), status: "PROVEN" },
    make("proof_ci_coverage", "Every required proof has one declared execution authority.", kinds, ids),
    { ...make("production_authority", "Production SQL remains Owner-only.", [], []), evidence: "PRODUCTION_DISCIPLINE", evidenceHash: sha256("PRODUCTION_DISCIPLINE"), status: "PROVEN" },
  ];
  if (effects.some((effect) => ["DATABASE", "SCHEMA", "RLS"].includes(effect))) rows.push(make("database_constraints", "Relevant disposable database constraints and fixtures pass before assertions.", ["postgres"], normalized.filter((item) => item.kind === "postgres" && (!(item.domains ?? []).length || item.domains.some((domain) => domains.includes(domain)))).map((item) => item.id)), make("current_migration_boundary", "The migration boundary is derived from the current ledger.", [], []));
  if (effects.some((effect) => ["API", "AUTHORIZATION"].includes(effect)) || operations.some((item) => item.operationKind === "rpc")) rows.push(make("rpc_api_signatures", "Relevant API/RPC signatures and authorization are source-proven.", ["unit", "postgres"], normalized.filter((item) => ["unit", "postgres"].includes(item.kind) && ((item.domains ?? []).some((domain) => domains.includes(domain)) || item.id === "auth-unit")).map((item) => item.id)));
  if (effects.some((effect) => ["WORKFLOW", "PRODUCTION", "PLATFORM", "EXTERNAL_PROCESS"].includes(effect))) rows.push(make("external_cli_contract", "Relevant external process exit, stdout, and stderr behavior is host-proven.", ["unit"], normalized.filter((item) => item.kind === "unit" && item.id !== "kernel-preflight" && ((item.effects ?? []).some((effect) => ["WORKFLOW", "PRODUCTION", "PLATFORM", "ENGINEERING_CONTROL"].includes(effect)) || (item.paths ?? []).some((path) => changedPaths.includes(path)))).map((item) => item.id)));
  return rows;
};

export const initializeTaskExperience = ({ taskId, task, context, identity }) => writeTaskExperience(taskId, {
  schemaVersion: 1,
  task: taskId,
  assumptions: deriveAssumptions({ risk: context.risk, identity, effects: context.effects ?? [], domains: context.domains, changedPaths: context.candidatePaths?.map((item) => item.path) ?? [], requiredProofs: (context.requiredProofRefs ?? []).map((id) => ({ id })) }),
  incidents: [],
  metrics: { taskStartedAt: new Date().toISOString(), events: {}, pushCount: 0, ciAttemptCount: 0, firstPassCiSuccess: null, repeatedFailureSignatures: 0, locallyReproducibleFailuresFirstDiscoveredRemotely: 0, proofExecutions: 0, proofReuse: 0, graphify: { queried: context.graphifyEvidence?.status === "GRAPHIFY_QUERIED" ? 1 : 0, cacheHit: context.graphifyEvidence?.status === "GRAPHIFY_CACHE_HIT" ? 1 : 0, fallback: !["GRAPHIFY_QUERIED", "GRAPHIFY_CACHE_HIT"].includes(context.graphifyEvidence?.status) ? 1 : 0 }, experienceContextBytes: Buffer.byteLength(JSON.stringify(context.experiencePacket ?? [])), ownerInterventions: 0 },
});

export const recordMetricEvent = (taskId, { type, key, concluded = false, success = false } = {}) => updateTaskMetrics(taskId, (metrics) => {
  if (!type || !key) throw new Error("METRIC_EVENT_ID_REQUIRED");
  const eventId = `${type}:${key}`, events = { ...(metrics.events ?? {}) };
  if (events[eventId]) {
    if (type !== "ci" || events[eventId].concluded || !concluded) return metrics;
    events[eventId] = { ...events[eventId], concluded: true, success, concludedAt: new Date().toISOString() };
    return { ...metrics, events, firstPassCiSuccess: metrics.firstPassCiSuccess === null ? success : metrics.firstPassCiSuccess };
  }
  events[eventId] = { type, key, concluded, success, recordedAt: new Date().toISOString() };
  const next = { ...metrics, events };
  if (type === "push") next.pushCount = (next.pushCount ?? 0) + 1;
  if (type === "ci") {
    next.ciAttemptCount = (next.ciAttemptCount ?? 0) + 1;
    if (next.firstPassCiSuccess === null && concluded) next.firstPassCiSuccess = success;
  }
  if (type === "proof-execution") next.proofExecutions = (next.proofExecutions ?? 0) + 1;
  if (type === "proof-reuse") next.proofReuse = (next.proofReuse ?? 0) + 1;
  if (type === "owner-gate") next.ownerInterventions = (next.ownerInterventions ?? 0) + 1;
  if (type === "remote-local-failure") next.locallyReproducibleFailuresFirstDiscoveredRemotely = (next.locallyReproducibleFailuresFirstDiscoveredRemotely ?? 0) + 1;
  return next;
});

export const writePrepushCertificate = (taskId, value) => (atomicWrite(prepushCertificatePath(taskId), value), value);
export const readPrepushCertificate = (taskId) => readJsonIfPresent(prepushCertificatePath(taskId), null);
export const invalidatePrepushCertificate = (taskId, reason) => {
  const current = readPrepushCertificate(taskId);
  if (!current) return null;
  return writePrepushCertificate(taskId, { ...current, status: "STALE", invalidatedBy: reason, invalidatedAt: new Date().toISOString() });
};

export const isGitStateChangingCommand = (command) => /\bgit(?:\.exe)?\s+(?:switch|checkout|merge|rebase|cherry-pick|commit|reset|worktree\s+(?:add|move|remove)|branch\s+(?:-m|-M|-d|-D))\b/i.test(String(command));
export const isGitStateRevalidationCommand = (command) => [ /git(?:\.exe)?\s+branch\s+--show-current/i, /git(?:\.exe)?\s+rev-parse\s+HEAD/i, /git(?:\.exe)?\s+status\s+--porcelain/i ].every((pattern) => pattern.test(String(command)));

export const externalCliInvocation = ({ command, nodeBin, platform = process.platform, nodeExecutable = process.execPath }) => platform === "win32" && nodeBin ? { executable: nodeExecutable, prefixArgs: [nodeBin] } : { executable: command, prefixArgs: [] };
export const runExternalCli = ({ command, nodeBin, args = [], platform = process.platform, nodeExecutable = process.execPath, spawn = spawnSync }) => {
  const invocation = externalCliInvocation({ command, nodeBin, platform, nodeExecutable }), result = spawn(invocation.executable, [...invocation.prefixArgs, ...args], { cwd: root, encoding: "utf8", shell: false, windowsHide: true });
  const stdout = String(result.stdout ?? ""), stderr = String(result.stderr ?? ""), combined = `${stdout}\n${stderr}`.trim();
  if (result.error || result.status !== 0) throw new Error(`EXTERNAL_CLI_FAILED:${command}:${result.status ?? result.error?.code ?? "UNKNOWN"}:${normalizeFailureSignature(combined)}`);
  return { exitCode: result.status, stdout, stderr, combined, invocation };
};

export const runDatabaseProofPhases = ({ schema, fixture, assertion, execute }) => {
  const results = [];
  for (const [phase, command] of [["schema", schema], ["fixture", fixture], ["assertion", assertion]]) {
    const result = execute(command, phase); results.push({ phase, exitCode: result.status ?? 1 });
    if (result.status !== 0) {
      const error = new Error(phase === "fixture" ? "FIXTURE_INVALID_BEFORE_ASSERTION" : `${phase.toUpperCase()}_PHASE_FAILED`);
      error.phase = phase; error.results = results; throw error;
    }
  }
  return results;
};

export const importCorroboratedDigest = (path) => {
  const digest = JSON.parse(readFileSync(path, "utf8")), promoted = [];
  for (const row of digest.incidents ?? []) {
    if (row.status !== "CORROBORATED" || !row.rootCause || !row.correction || !row.preventionCandidate || !row.evidence?.length || !/pass|green|merged|ready/i.test(row.verification ?? "")) continue;
    const incident = {
      fingerprint: sha256(row.fingerprint), status: "VERIFIED", task: digest.task, domains: row.domains ?? [], pathHints: row.paths ?? [], proofKinds: [], environment: row.environment ? { observed: row.environment } : {}, occurrences: 1,
      evidenceRefs: row.evidence, failureSignature: normalizeFailureSignature(row.observableFailure), invalidatedAssumption: row.invalidatedAssumption, rootCause: row.rootCause, correctionPrinciple: row.preventionCandidate, regressionRefs: row.evidence.filter((value) => /commit:|run:|pr:|deployment:/.test(value)).slice(-3), regressionPassed: true, confidence: "CORROBORATED", supersession: null,
    };
    upsertIncident(incident); promoted.push(incident.fingerprint);
  }
  return { status: "INCIDENT_DIGEST_RECONCILED", task: digest.task, promoted };
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = parseArgs(), path = args.value("--import-digest");
  try {
    if (path) console.log(JSON.stringify(importCorroboratedDigest(path), null, 2));
    else if (args.has("--init-active")) {
      const task = findActiveTask(); if (!task) throw new Error("ACTIVE_TASK_REQUIRED");
      const context = JSON.parse(readFileSync(resolve(taskDirectory(task.taskId), "context.json"), "utf8"));
      console.log(JSON.stringify(initializeTaskExperience({ taskId: task.taskId, task: task.task, context, identity: repositoryIdentity() }), null, 2));
    } else if (args.has("--refresh-active-context")) {
      const task = findActiveTask(); if (!task) throw new Error("ACTIVE_TASK_REQUIRED");
      const path = resolve(taskDirectory(task.taskId), "context.json"), context = JSON.parse(readFileSync(path, "utf8"));
      context.experiencePacket = selectExperience({ task: task.task, domains: context.domains, risk: context.risk, candidatePaths: context.candidatePaths, requiredProofIds: context.requiredProofRefs, requiredProofKinds: context.requiredProofKinds, environment: { platform: process.platform } }); atomicWrite(path, context);
      const experience = readTaskExperience(task.taskId); writeTaskExperience(task.taskId, { ...experience, metrics: { ...experience.metrics, experienceContextBytes: Buffer.byteLength(JSON.stringify(context.experiencePacket)) } });
      console.log(JSON.stringify({ task: task.taskId, experiencePacket: context.experiencePacket }, null, 2));
    } else throw new Error("EXPERIENCE_COMMAND_REQUIRED");
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
