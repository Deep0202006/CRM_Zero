---
name: zd-change-plan
description: Use before implementing cross-domain, R2, or R3 ZeroData work.
---
# ZD Change Plan

Required inputs: outcome, non-goals, affected domains, acceptance criteria.

Workflow: create `.harness/task.json`; classify risk; read affected contracts/code/tests; list invariants and allowed paths; create an ExecPlan for R3 or large R2; define verification and rollback.

Docs: `docs/os/RISK_MODEL.md`, `docs/os/CHANGE_PROTOCOL.md`, `docs/exec-plans/TEMPLATE.md`.

Checks: risk not silently downgraded; production/schema flags explicit; scope is testable.

Output: manifest path, risk, domains, plan path if used, gates, and open decisions.
