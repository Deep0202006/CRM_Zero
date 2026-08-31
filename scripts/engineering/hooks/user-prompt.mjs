import { resolveContext } from "../context.mjs";
import { mintOwnerPermit } from "../release-controller.mjs";
import { beginExternalTask, readHookInput, requireContinuation, updateState } from "./state-store.mjs";
const input = await readHookInput(), sessionId = input.session_id ?? "unknown", prompt = input.prompt ?? input.user_prompt ?? "";
if (/^OWNER_RELEASE_APPROVED\|/.test(prompt)) {
  const permit = mintOwnerPermit({ line: prompt, sessionId });
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: JSON.stringify({ ownerReleasePermit: permit, completionClaim: false }) } }));
  process.exit(0);
}
const continuation = /^KERNEL_CONTINUE\|taskId=([a-f0-9-]+)\b/i.exec(prompt);
const expansion = /^KERNEL_SCOPE_EXPAND\|taskId=([a-f0-9-]+)\|path=([^|\s]+)\|task=(.+)$/i.exec(prompt);
let state;
if (expansion) {
  state = requireContinuation(sessionId, expansion[1]);
  const resolution = resolveContext({ task: expansion[3], exactPath: expansion[2] });
  state = updateState(sessionId, (current) => ({ ...current, resolution, scopeRevision: current.scopeRevision + 1, status: resolution.status === "RESOLVED" ? "IMPLEMENTATION_IN_PROGRESS" : "SCOPE_UNRESOLVED" }));
} else if (continuation) state = requireContinuation(sessionId, continuation[1]);
else state = beginExternalTask(sessionId, prompt);
if (!continuation && !expansion) {
  const resolution = resolveContext({ task: prompt });
  state = updateState(sessionId, (current) => ({ ...current, resolution, status: resolution.status === "RESOLVED" ? "IMPLEMENTATION_IN_PROGRESS" : "SCOPE_UNRESOLVED" }));
}
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: JSON.stringify({ taskId: state.taskId, status: state.status, resolution: state.resolution }) } }));
