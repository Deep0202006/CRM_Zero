# Pipeline Migration Review

Migration: `supabase/migrations/032_pipeline_authoritative_transitions.sql`. Status: **OWNER APPROVAL REQUIRED; not applied**.

## Proven deployed state

Read-only REST/OpenAPI inspection on 2026-08-10 found 33 leads: 31 New, one Contacted, one Payment; zero null/orphan assignments; all assignments resolved to a user. `stage_entered_at` and `onboarded_at` exist. `updated_at` and immutable creator fields do not. The deployed enum exposes seven values, without Renewal Due. The old four-argument RPC is exposed.

Policy, grant, trigger/function body, cron, and task-fan-out definitions are UNKNOWN because catalog access was unavailable.

## Proposed future-only changes

- Add the frozen Renewal Due enum value.
- Add an idempotency ledger without backfilling leads.
- Guard future direct authenticated status updates.
- Add a service-only v2 transition enforcing owner, expected stage, employee matrix, and operation identity.
- Revoke browser access to the unsafe legacy RPC. Trusted system renewal remains possible.

No existing lead row is changed. The migration is additive except for future permission/write enforcement.

## Compatibility blockers

Read-only catalog review must confirm the existing timestamp trigger, renewal execution context, old RPC signature/grants, and absence of legitimate direct authenticated status writers.

## Rollback and order

Before application, withhold approval. After an authorized deployment, roll back the app first, then remove the future-write guard/function if required while retaining the ledger. The additive enum label is not safely removable and must not be rolled back through row rewrites.

Order: catalog review → owner approval → migration → app deployment → read-only board verification. The app returns a safe unavailable transition state before the migration exists.
