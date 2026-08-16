# Change Protocol

## CURRENT

1. Run preflight and inspect current instructions.
2. Create `.harness/task.json` using the documented schema.
3. Read affected contracts, code, and tests.
4. Plan proportionally; R3 requires an active ExecPlan.
5. Implement only allowed paths.
6. Run related tests during work and risk-based verification before review.
7. Review the diff and update durable knowledge when behavior or protection changes.
8. For every new business field, verify write, personal readback, admin readback, export parity, legacy-row behavior, and offline current/previous payload compatibility where applicable.

Task manifest fields: `task`, `risk`, `domains`, `allowedPaths`, `protectedDomains`, `productionDataMutation`, `schemaChange`, `acceptance`.

If the task begins with unrelated work, `trackedBaseline` may list exact pre-existing tracked paths and `untrackedBaseline` may list exact pre-existing untracked paths/prefixes so the scope guard preserves them without treating them as task output. Baselines are not task authorization and must never be broadened after implementation begins.

Re-planning is explicit: update the manifest before editing newly allowed paths and record why in the active plan or task notes.

## INVARIANT

No production data mutation, destructive action, schema/RLS change, or API-contract change is implied by an ordinary implementation task.

## KNOWN DEBT

The manifest is intentionally plain JSON and does not model a dependency graph.
