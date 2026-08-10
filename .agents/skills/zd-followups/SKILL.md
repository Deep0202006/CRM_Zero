---
name: zd-followups
description: Use for call or visit follow-up scheduling, reconciliation, ownership, or completion changes.
---
# ZD Follow-ups

Required inputs: source type, owner, schedule/completion symptom.

Workflow: read follow-up plus source contract; trace stable source identity and confirmed completion; preserve legacy unknowns; verify self-scope and KPI effects.

Docs: `docs/contracts/followups.md`, `docs/contracts/calls.md`, `docs/contracts/field-visits.md`.

Checks: no fabricated completion, explicit ownership, stable IDs, related follow-up tests.

Output: source-to-follow-up mapping, invariants, tests, and compatibility notes.
