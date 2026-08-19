<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repository uses the installed Next.js version as authority. Before changing
Next.js APIs, conventions, routing, caching, rendering, middleware, or server
behavior, read the relevant guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

# CRM_Zero Engineering Authority

Repository scope: `Deep0202006/CRM_Zero` only.

## The engineering controller is authoritative

Engineering flow, task state, transition legality, blocker semantics, proof
reuse, worktree authority, and human production gates are owned by:

- `.crm-engineering/manifest.json`
- `.crm-engineering/policy/`
- `.crm-engineering/knowledge/`
- `.crm-engineering/tasks/`
- `tools/crm-graph/`
- `docs/engineering-graph/`

Run the controller instead of inventing workflow from prose:

```powershell
npm run crm:status -- --task <TASK_ID>
npm run crm:context -- --task <TASK_ID>
npm run crm:run -- --task <TASK_ID>
```

## Legacy governance is not execution authority

The pre-graph governance under `docs/os/`, old `.harness/` task manifests,
historical execution plans, archived worktrees, repair folders, chat prompts,
and completed checkpoints are evidence/history only unless the current graph
task explicitly imports a fact from them.

They MUST NOT determine:
- current workflow phase;
- whether work is complete;
- whether work is blocked;
- what verification runs next;
- what worktree is authoritative;
- whether production action is allowed.

The context compiler excludes legacy/vendor/generated trees by default.

## Normative business knowledge

Business semantics are loaded through the CRM knowledge registry and the
current affected domain contracts. One fact has one authority.

Do not create a second editable authority for an existing business fact.

## Non-negotiable owner safety

- Never fabricate or write test business data to production.
- Never delete production business history to make a test pass.
- Owner SQL / production schema mutation requires an explicit human gate.
- Do not expose service-role credentials to browser/client code.
- Preserve unknown owner work.
- Do not reset, clean, prune, overwrite, or delete unknown dirty work.
- Applied owner migrations are immutable; use a forward migration.
- Do not push directly to `main` or force-push.

## Repository rule

Canonical root:

`C:\Users\dcp69\Desktop\CRM_Zero`

Any non-root development worktree must live below:

`C:\Users\dcp69\Desktop\CRM_Zero\.worktrees\`

A task may not start implementation unless repository preflight is green.

## Agent role

Codex is an implementation worker inside the graph. It does not own:
- task completion;
- persistent BLOCKED state;
- phase transitions;
- release authorization;
- production authorization.

If required implementation acceptance remains incomplete and there is no valid
external/human/safety blocker, the legal next action is IMPLEMENT/REPAIR.

## Context rule

Load only the context packet produced for the current task/node. Do not preload
all contracts, migrations, archived repairs, old governance, or historical
worktrees.

## Scoped AGENTS files

Scoped AGENTS files may add local domain constraints only. They cannot redefine
the engineering workflow or override graph state.
