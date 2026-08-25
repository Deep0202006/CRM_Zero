import {
  loadState,
  readInput,
  repositoryState,
  saveState,
  sha,
} from "./state.mjs";
const input = await readInput(),
  session_id = input.session_id ?? "unknown",
  state = loadState(session_id),
  repo = repositoryState(),
  result = input.tool_response ?? input.tool_result ?? {},
  failed =
    input.is_error === true ||
    result?.isError === true ||
    Number(result?.exit_code ?? result?.exitCode ?? 0) !== 0,
  signature = failed
    ? sha(
        JSON.stringify({
          tool: input.tool_name,
          status: result?.exit_code ?? result?.exitCode ?? "error",
        }),
      )
    : null;
saveState({
  ...state,
  session_id,
  ...repo,
  lastFailureSignature: signature,
  failureSignatures: signature
    ? [...new Set([...(state.failureSignatures ?? []), signature])]
    : (state.failureSignatures ?? []),
});
