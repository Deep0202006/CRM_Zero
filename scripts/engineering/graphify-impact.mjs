import { resolveContext } from "./context.mjs";
import { parseArgs } from "./kernel-lib.mjs";
const task = parseArgs().value("--task", ""), context = resolveContext({ task });
if (!task) { console.error("SCOPE_AMBIGUOUS"); process.exit(2); }
console.log(JSON.stringify({ taskHash: context.taskHash, structuralEvidence: { ...context.graphifyEvidence, paths: context.graphifyEvidence.paths.map((item) => item.path) }, mergedCandidatePaths: context.candidatePaths.map((item) => ({ path: item.path, evidenceType: item.evidenceType, confidence: item.confidence })), authoritySource: "CURRENT_REGISTRIES" }));
