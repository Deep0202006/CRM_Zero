# Attendance Authority Root Fix

## Goal

Make Team Attendance and Team KPI derive presence from confirmed attendance business rows for the selected IST date, independently of selfie evidence.

## Non-goals

No schema, migration, production-data repair, evidence restoration, or Receivables behavior change.

## Current state

The code fix and regression tests are complete on PR #30. Release gates and read-only production acceptance remain.

## Invariants

- No production mutation, attendance-row rewrite, user change, or evidence restoration.
- Attendance rows are permanent business authority; media lifecycle is separate.
- Server list reads use explicit columns and bounded date ranges.
- Realtime causes a deduplicated targeted refetch, never polling.

## Affected domains

Attendance, Team KPI, Admin Attendance API/UI, regression tests, and focused Engineering OS guards.

## Implementation steps

1. Resolve attendance from confirmed rows keyed by employee and IST business date.
2. Read Admin Attendance from a bounded server endpoint without image payloads.
3. Reuse the resolver in Team KPI and add targeted Realtime convergence.
4. Preserve daily, weekly, monthly, and export behavior.

## Root cause

Admin Team Attendance reads only browser-local Dexie. It does not request the authoritative server attendance register when opened or refreshed. A valid server row absent from that browser cache is rendered as Absent. Evidence lifecycle fields are not the business predicate, but three of four production attendance rows today have no current image, making the missing authority boundary visible after evidence hardening.

## Verification

Focused resolver/API/UI tests, disposable browser tests, full Jest, typecheck, lint, build, harness, CI, preview, and read-only production reconciliation.

## Production safety

- [x] Production mutation is not authorized and is not required.
- [x] Schema/RLS impact is not applicable.
- [x] Read-only attendance reconciliation completed.
- [x] Production connections and secrets are excluded from CI and local tests.

## Rollback

Revert PR #30. No data or schema rollback is required.

## Decision log

- Server-confirmed attendance rows are reporting authority; evidence is independent.
- Stored attendance `date` is the authoritative IST business date.
- Realtime triggers a deduplicated targeted refresh; polling is prohibited.

## Progress

- [x] Root cause and production exposure confirmed read-only.
- [x] Code, focused tests, browser tests, and local R3 gates completed.
- [ ] PR CI, merge, production deployment, and read-only acceptance completed.
