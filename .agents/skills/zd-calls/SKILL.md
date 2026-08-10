---
name: zd-calls
description: Use for call logging, call history, call retry, and confirmed-call attribution changes.
---
# ZD Calls

Required inputs: call journey and intended outcome.

Workflow: read call contract and scoped instructions; trace UI identity → local save/outbox → exact confirmation → history/KPI; preserve IDs/ownership; verify free-text identity never enters `lead_id`; ensure priority confirmation does not bypass the outbox; change narrowly; run related tests and guard.

Docs: `docs/contracts/calls.md`, `src/lib/callLogs/AGENTS.md`.

Checks: no delete/clear, approved confirmation API, stable retry ID/idempotency key, exact queue removal only after confirmation, UUID/text identity separation, canonical employee/Admin counts; history totals use authoritative count metadata, never loaded-array length.

Output: changed flow, invariants retained, tests, and recovery behavior.
