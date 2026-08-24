import { loadState, readInput, repositoryState, saveState } from "./state.mjs";
const input=await readInput();const session_id=input.session_id??"unknown";saveState({...loadState(session_id),session_id,...repositoryState()});console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:"ZeroGraph control plane active; acceptance remains evidence-derived."}}));
