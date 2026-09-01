import assert from "node:assert/strict";
import { prohibitedRuntimeSettings } from "./codex-runtime-authority.mjs";

assert.deepEqual(prohibitedRuntimeSettings('approval_policy="never"\nmodel="x"\n[sandbox_workspace_write]\nnetwork_access=true\n'), ["approval_policy", "model", "sandbox_workspace_write.network_access"]);
assert.deepEqual(prohibitedRuntimeSettings('project_doc_max_bytes=16384\n# model="documentation only"\n[shell_environment_policy]\ninherit="core"\n'), []);
console.log("CODEX_RUNTIME_AUTHORITY_TEST_PASS");
