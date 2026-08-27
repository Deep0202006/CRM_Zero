import { loadState, readHookInput, repositoryIdentity, sanitizedFailureSignature, updateState } from "./state-store.mjs";
const input = await readHookInput(), sessionId = input.session_id ?? "unknown", state = loadState(sessionId), result = input.tool_response ?? input.tool_result ?? {};
const exitCode = Number(result.exit_code ?? result.exitCode ?? (input.is_error || result.isError ? 1 : 0));
const signature = exitCode ? sanitizedFailureSignature({ tool: input.tool_name, input: input.tool_input, exitCode, stdout: result.stdout ?? result.output, stderr: result.stderr ?? result.error }) : null;
const repository = repositoryIdentity(), changed = JSON.stringify(repository) !== JSON.stringify(state.repository);
updateState(sessionId, (current) => ({ ...current, repository, evidence: changed ? [] : current.evidence, status: changed ? "LOCAL_PROOFS_REQUIRED" : current.status, failureSignatures: signature ? [...new Set([...(state.failureSignatures ?? []), signature])] : state.failureSignatures }));
