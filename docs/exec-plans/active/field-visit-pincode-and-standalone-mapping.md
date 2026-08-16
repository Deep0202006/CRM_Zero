# Execution Plan: Field Visit pincode and standalone Mapping

## Goal

Add pincode to new Retailer and Distributor visits through the existing durable confirmation flow, preserve legacy visits and queued payloads, close read/admin/export coverage, and restore Mapping as a standalone free-text logging feature using the same option authority as Calls and Client Query.

## Non-goals

- No Visit card redesign, evidence/GPS/selfie/retention behavior change, or extra request.
- No Pipeline, Lead, receivable, payment, attendance, task, or call mutation.
- No production data mutation, fake pincode backfill, polling, Realtime, N+1, or unbounded reads.

## Current state

Visit rows and offline payloads use the existing `address` authority and lack pincode. Mapping currently hydrates Pipeline Leads and materializes placeholder Leads for arbitrary text. Calls and Client Query derive suggestions from the existing local client directory.

## Invariants

- Stable visit and mapping IDs survive retries.
- Historical Visit pincode remains nullable and neutral on read/export.
- New Visit UI and current command require trimmed non-empty bounded text pincode.
- Previous authentic queued Visit payloads follow the existing repair policy and never retry deterministic 4xx.
- Mapping display values preserve user-entered text and never create or transition Leads.
- Existing Field Visit evidence, GPS, confirmation, recovery, and five-day retention remain intact.

## Affected domains

Field Visits, Mapping, shared option discovery for Calls/Client Query, Admin Visit reporting/export, Supabase additive schema, and Engineering OS guards.

## Implementation steps

1. Trace Visit capture, Dexie transaction, confirmation API, reads, overview, export, retention, and retry classification.
2. Trace Calls/Client Query option inputs and Mapping persistence/side effects.
3. Add nullable pincode schema/owner artifacts and enforce it only for new commands while preserving prior queued operations.
4. Add form/read/export pincode closure without card redesign or request expansion.
5. Extract/reuse one canonical suggestion provider and remove Mapping's Pipeline/Lead dependency.
6. Add focused fixtures and enforceable OS/harness guards.

## Verification

Focused Visit, Mapping, offline/retry, export, cross-domain isolation, migration/SQL guards, then R3 harness verification, Jest, typecheck, lint, build, and applicable E2E/exact-head CI gates.

## Production safety

- [x] Production mutation is not authorized and is excluded.
- [x] Additive nullable schema is owner-applied only; local work will not contact production.
- [ ] Read-only schema assumptions certified by precheck/postcheck artifacts.
- [x] Secrets and production connections excluded from CI/local tests.

## Rollback

Revert application changes. The nullable pincode column may safely remain unused; no historical data rollback or destructive SQL is required.

## Decision log

- Classified R3 because an additive production schema artifact is required.
- Selected migration number 041 after enumerating tracked migrations through 040; existing untracked owner-039 artifacts are unrelated baseline work.

## Progress

- Implementation, focused tests, full Jest (490/490), typecheck, production build, changed-file lint, harness scope/guard/docs, Field Visit E2E (4/4), and Mapping E2E (1/1) pass.
- PostgreSQL runtime apply/RLS verification is unavailable locally because Docker and `psql` are not installed; pure-SQL precheck/postcheck and static migration guards pass.
- Repository-wide lint remains blocked by pre-existing unrelated errors in `scratch/*.js` and `src/app/my-day/page.tsx`; scoped changed-file lint has zero errors.
- Owner migration 044 is not applied to production.
