# CRM Engineering Graph — Start Here

This is the authoritative human map for engineering `Deep0202006/CRM_Zero`.

## Authority hierarchy

1. Owner-approved business rule / current domain authority registry
2. `.crm-engineering/policy/` deterministic rules
3. `.crm-engineering/tasks/<TASK>.json` current task state
4. `.crm-engineering/proofs/` exact-SHA evidence
5. affected `docs/contracts/` for normative domain semantics
6. current source/schema/tests for observed implementation
7. legacy governance/historical plans only as evidence

Old `docs/os` workflow prose and `.harness/task.json` do not control execution.

## New session

Run:

```powershell
npm run crm:status -- --task CRM-P0-045
npm run crm:context -- --task CRM-P0-045
```

Read the generated `CRM_CONTEXT.md`.

Do not ask a new chat to reconstruct CRM from old chat history.

## Human gates

Owner SQL and production data/schema mutation stop at a persistent graph
interrupt. They resume only after explicit owner approval and recorded evidence.
