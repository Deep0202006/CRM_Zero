---
name: zd-production-safety
description: Use whenever production data, Supabase, auth, schema, RLS, secrets, or destructive operations may be involved.
---
# ZD Production Safety

Required inputs: target environment, intended action, authorization, rollback.

Workflow: classify R3; read data authority and Supabase guidance; audit read-only first; verify exact target; keep automated tests/QA/smoke checks off live business writes; use mocks, isolated fixtures, local/preview environments, and read-only reconciliation; require active ExecPlan and checklist; stop before mutation without the owner explicitly authorizing that exact production change.

Docs: `docs/quality/GOLDEN_PRINCIPLES.md`, `docs/architecture/DATA_AUTHORITY.md`, `supabase/AGENTS.md`.

Checks: no deletes/clears, no secret exposure, no migration inference, no production mutation in CI, and no production dummy-data lifecycle (insert/update then cleanup) during testing.

Output: authorization status, verified target, safety checks, rollback, and proceed/blocked decision.
