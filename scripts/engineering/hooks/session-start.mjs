import { doctor } from "../kernel-doctor.mjs";
import { loadState, readHookInput, repositoryIdentity, updateState } from "./state-store.mjs";
const input = await readHookInput(), sessionId = input.session_id ?? "unknown", current = loadState(sessionId), health = doctor();
updateState(sessionId, () => ({ ...current, repository: repositoryIdentity(), status: health.failures.length ? "SAFETY_CONFLICT" : current.status }));
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: JSON.stringify({ kernel: health.status, status: current.status, completionClaim: false }) } }));
