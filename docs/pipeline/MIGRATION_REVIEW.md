# Pipeline Migration Review

Migration: `supabase/migrations/032_pipeline_authoritative_transitions.sql`. Status: **owner confirms applied; deployed enum and operation ledger verified read-only on 2026-08-10**.

## Proven deployed state

Post-application read-only REST/OpenAPI inspection found 34 leads with zero null/orphan assignments. `stage_entered_at` and `onboarded_at` exist; `updated_at` and immutable creator fields do not. The deployed enum exposes all eight frozen values. The operation ledger contained 40 unique operation IDs at audit time.

Policy, grant, trigger/function body, cron, and exact task-fan-out definitions remain UNKNOWN because catalog access was unavailable.

## Applied future-only changes

- Added the frozen Renewal Due enum value.
- Added an idempotency ledger without backfilling leads.
- Added a future direct authenticated status-write guard.
- Added a service-only v2 transition enforcing owner, expected stage, matrix, and operation identity.
- Revoked browser access to the unsafe legacy RPC.

Migration 032 contains no mass existing-lead status update. It is additive except for future permission/write enforcement. PR #20's authority switch, not the migration, exposed disagreements with older browser-local state.

## Remaining evidence gaps

Read-only catalog review is still required to prove timestamp-trigger, renewal, and task side-effect behavior. Historical SQL contains potentially non-idempotent task inserts. Browser-local queues cannot be remotely enumerated. Do not infer deployed behavior solely from this migration file.

## Recovery and rollback boundary

Do not reapply or roll back migration 032 for local-stage reconciliation. Recovery must use evidence-backed canonical v2 transitions and preserve the operation ledger. The enum label is not safely removable and must not be removed through row rewrites.
