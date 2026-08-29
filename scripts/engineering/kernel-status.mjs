import { resolve } from "node:path";
import { loadState } from "./hooks/state-store.mjs";
import { parseArgs, repositoryIdentity } from "./kernel-lib.mjs";
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const session = parseArgs().value("--session", "unknown");
  console.log(JSON.stringify({ repository: repositoryIdentity(), session: loadState(session) }, null, 2));
}
