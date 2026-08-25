import { execFileSync, spawnSync } from "node:child_process";
import {
  loadState,
  readInput,
  repositoryState,
  root,
  saveState,
  sha,
} from "./state.mjs";
const input = await readInput(),
  session_id = input.session_id ?? "unknown",
  prompt = input.prompt ?? input.user_prompt ?? "",
  state = loadState(session_id),
  internal = /^(ZEROGRAPH_CONTINUE|ZEROGRAPH_STALL_REPORT)\|/.test(prompt);
let context = "ZeroGraph continuation; retain original Owner task identity.";
if (!internal) {
  const repo = repositoryState();
  if (state.taskClosed) {
    for (const key of [
      "originalTaskHash",
      "taskBaseHeadSha",
      "taskBaseTreeSha",
      "taskBaseDirtyFingerprint",
      "proofEvidenceHashes",
      "failureSignatures",
      "learning",
      "remoteEvidence",
      "graphifyNavigation",
    ])
      delete state[key];
    state.taskClosed = false;
  }
  state.originalTaskHash ??= sha(prompt);
  state.requestedImplementation ??=
    /\b(add|build|change|create|fix|implement|remove|repair|update|upgrade)\b/i.test(
      prompt,
    );
  state.taskBaseHeadSha ??= repo.currentHeadSha;
  state.taskBaseTreeSha ??= repo.currentTreeSha;
  state.taskBaseDirtyFingerprint ??= repo.currentDirtyFingerprint;
  try {
    const resolved = execFileSync(
        "node",
        ["scripts/engineering/context.mjs", "--task", prompt],
        { cwd: root, encoding: "utf8" },
      ),
      pack = JSON.parse(resolved);
    Object.assign(state, {
      resolvedDomains: pack.domains,
      resolverConfidence: pack.confidence,
      resolverMargin: pack.margin,
      resolutionHash: sha(resolved),
    });
    if (pack.confidence < 0.7 || pack.margin < 0.3 || pack.domains.length > 1) {
      const graph = spawnSync(
        "node",
        ["scripts/engineering/graphify-impact.mjs", "--task", prompt],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, GRAPHIFY_QUERY_LOG_DISABLE: "1" },
        },
      );
      if (graph.status === 0) {
        const result = JSON.parse(graph.stdout);
        state.graphifyNavigation = {
          taskHash: state.originalTaskHash,
          domains: pack.domains,
          paths: result.structuralEvidence?.paths ?? [],
          status: result.structuralEvidence?.status,
        };
      }
    }
    context = JSON.stringify({
      taskHash: state.originalTaskHash,
      domains: pack.domains,
      confidence: pack.confidence,
      paths: pack.candidatePaths,
      authorities: pack.authorities,
      capabilities: pack.capabilities,
      mustNotWriteAuthorities: pack.mustNotWriteAuthorities,
      risk: pack.risk,
      proofs: pack.requiredProofRefs,
    }).slice(0, 3000);
  } catch {
    context = `taskHash=${state.originalTaskHash}; CONTEXT_AMBIGUOUS`;
  }
}
saveState({ ...state, session_id, ...repositoryState() });
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context,
    },
  }),
);
