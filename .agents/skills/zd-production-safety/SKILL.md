---
name: zd-production-safety
description: Use whenever production data, Supabase, auth, schema, RLS, secrets, or destructive operations may be involved.
---
# ZD Production Safety

Required inputs: target environment, intended action, authorization, rollback.

Workflow: classify R3; read data authority and Supabase guidance; audit read-only first; verify exact target; require active ExecPlan and checklist; stop before mutation without explicit authorization.

Docs: `docs/quality/GOLDEN_PRINCIPLES.md`, `docs/architecture/DATA_AUTHORITY.md`, `supabase/AGENTS.md`.

Checks: no deletes/clears, no secret exposure, no migration inference, no production mutation in CI.

Output: authorization status, verified target, safety checks, rollback, and proceed/blocked decision.
