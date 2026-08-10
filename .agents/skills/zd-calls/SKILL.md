---
name: zd-calls
description: Use for call logging, call history, call retry, and confirmed-call attribution changes.
---
# ZD Calls

Required inputs: call journey and intended outcome.

Workflow: read call contract and scoped instructions; trace local save → confirmation → history; preserve IDs/ownership; change narrowly; run related tests and guard.

Docs: `docs/contracts/calls.md`, `src/lib/callLogs/AGENTS.md`.

Checks: no delete/clear, approved confirmation API, stable retry ID, server-confirmed authority.

Output: changed flow, invariants retained, tests, and recovery behavior.
