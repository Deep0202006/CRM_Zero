import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readInput, root } from "./state.mjs";
const input = await readInput(),
  tool = input.tool_name ?? "",
  payload = JSON.stringify(input.tool_input ?? {}),
  editTool = /^(apply_patch|Edit|Write)$/.test(tool),
  mutatingBash =
    tool === "Bash" &&
    /(?:^|[;&|]\s*)(?:Set-Content|Add-Content|Remove-Item|Move-Item|Copy-Item|sed\s+-i|perl\s+-pi)|(?:^|\s)(?:>|>>)/i.test(
      payload,
    ),
  boundary = JSON.parse(
    readFileSync(
      resolve(root, "supabase/migrations/APPLIED_OWNER_MIGRATIONS.json"),
    ),
  ).immutableThrough;
const migration =
  (editTool || mutatingBash) &&
  [...payload.matchAll(/supabase[\\/]migrations[\\/](\d+)_/g)].some(
    (m) => Number(m[1]) <= boundary,
  );
const locked =
  (editTool || mutatingBash) &&
  /OS_V3_ACCEPTANCE(?:\.lock)?\.json|\.codex[\\/]hooks\.json/.test(payload);
const dangerous =
  /git\s+reset\s+--hard|git\s+clean\s+-[^\s]*[fd]|git\s+push[^\n]*(?:--force|-f)|git\s+push[^\n]*\bmain\b|supabase[^\n]*(?:db\s+(?:push|reset)|migration\s+up)|gwfjkpsoaoherntwhdyf[^\n]*(?:insert|update|delete|apply)|(?:install|choco|winget|apt)[^\n]*(?:postgres|docker)/i.test(
    payload,
  );
if (locked || migration || dangerous)
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `SAFETY_CONFLICT:${tool}`,
      },
    }),
  );
