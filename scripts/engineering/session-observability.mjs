import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { findActiveTask, readTaskSnapshot } from "./task-state.mjs";
import { parseArgs, repositoryIdentity, sha256 } from "./kernel-lib.mjs";
import { readSessionState, sessionsDirectory } from "./hooks/state-store.mjs";

const sessionIds = () => existsSync(sessionsDirectory()) ? readdirSync(sessionsDirectory()).filter((name) => name.endsWith(".json") && !/\.(?:corrupt|v1-preserved|tmp)-/.test(name)).map((name) => name.slice(0, -5)).sort() : [];
export const sessionSnapshot = ({ sessionId } = {}) => {
  const active = findActiveTask(), candidates = sessionId ? [sessionId] : sessionIds(), sessions = candidates.map((id) => { try { return readSessionState(id); } catch (error) { return { sessionId: id, error: error.message }; } }), selected = sessionId ? sessions[0] : sessions.find((state) => state.boundTaskId === active?.taskId) ?? null;
  const taskId = selected?.boundTaskId ?? (sessionId ? null : active?.taskId) ?? null, task = taskId ? readTaskSnapshot(taskId) : null, repository = repositoryIdentity();
  return { schemaVersion: 1, sessionId: selected?.sessionId ?? null, session: selected, boundSessions: sessions.filter((state) => state.boundTaskId === taskId).map((state) => state.sessionId), task, repository: { ...repository, dirty: repository.dirtyFingerprint !== sha256("") } };
};
export const sessionStatus = (options = {}) => { const snapshot = sessionSnapshot(options); return { schemaVersion: 1, sessionId: snapshot.sessionId, boundTaskId: snapshot.session?.boundTaskId ?? null, activeTaskId: snapshot.task?.taskId ?? null, sessionStatus: snapshot.session?.status ?? "UNBOUND", taskStatus: snapshot.task?.status ?? null, branch: snapshot.task?.repository.branch ?? null, head: snapshot.repository.headSha, dirty: snapshot.repository.dirty, blockers: snapshot.task?.blockers.length ?? 0, pendingAcceptance: snapshot.task?.acceptance.filter((item) => item.status !== "PASS").length ?? 0, nextAction: snapshot.task?.nextAction ?? "Create or resume one durable task." }; };

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const args = parseArgs(), options = { sessionId: args.value("--session") }, result = args.has("--snapshot") ? sessionSnapshot(options) : sessionStatus(options);
  console.log(JSON.stringify(result, null, 2));
}
