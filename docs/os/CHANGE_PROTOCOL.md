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

For an incident, freeze the issue contract before implementation: `USER-OBSERVED FAILURE`, `AUTHORITATIVE EXPECTED RESULT`, `WRITE PATH`, `READ PATH`, and `ACCEPTANCE INVARIANT`. Only causal surfaces on that path may block the incident. Distinguish a bug fix from a new business policy; do not invent unrelated time limits, permissions, financial semantics, or lifecycle rules.

Every important business mutation requires write-to-read closure: a successful authoritative write must converge in every authoritative reader (for example Attendance → Team Attendance/KPI, renewal → Payment Collection/My Day, payment confirmation → outstanding/history). Declare a role matrix covering every distinct supported capability shape: who may write, who may read, and which records are visible. CI fixtures must exercise each distinct shape rather than one generic `employee`.

Task manifest fields: `task`, `risk`, `domains`, `allowedPaths`, `protectedDomains`, `productionDataMutation`, `schemaChange`, `acceptance`.

Before implementation, acceptance must lock `USER REQUEST`, `EXPECTED USER FLOW`, `CANONICAL AUTHORITY`, and `WHAT MUST NOT CHANGE`. Classify the intended change as any applicable combination of `UI_ONLY`, `API`, `DATABASE`, `AUTHORIZATION`, `OFFLINE CONTRACT`, `CROSS_DOMAIN`, and `DEPLOYMENT`. A migration is not considered unless `DATABASE` is declared.

Every mutation declares its allowed table write set; fixture tests fail on any write outside it. Every screen declares initial request count, maximum page, polling, payload/binary bounds, and query pattern. Check `docs/os/AUTHORITY_REGISTRY.json` before adding storage or a parallel command. Empty, unauthorized, server-error, and capability-missing states remain distinct.

If the task begins with unrelated work, `trackedBaseline` may list exact pre-existing tracked paths and `untrackedBaseline` may list exact pre-existing untracked paths/prefixes so the scope guard preserves them without treating them as task output. Baselines are not task authorization and must never be broadened after implementation begins.

Re-planning is explicit: update the manifest before editing newly allowed paths and record why in the active plan or task notes.

## INVARIANT

No production data mutation, destructive action, schema/RLS change, or API-contract change is implied by an ordinary implementation task.

## KNOWN DEBT

The manifest is intentionally plain JSON and does not model a dependency graph.
