# Attendance Authority Root Fix

## Goal

Make Team Attendance and Team KPI derive presence from confirmed attendance business rows for the selected IST date, independently of selfie evidence.

## Invariants

- No production mutation, attendance-row rewrite, user change, or evidence restoration.
- Attendance rows are permanent business authority; media lifecycle is separate.
- Server list reads use explicit columns and bounded date ranges.
- Realtime causes a deduplicated targeted refetch, never polling.

## Root cause

Admin Team Attendance reads only browser-local Dexie. It does not request the authoritative server attendance register when opened or refreshed. A valid server row absent from that browser cache is rendered as Absent. Evidence lifecycle fields are not the business predicate, but three of four production attendance rows today have no current image, making the missing authority boundary visible after evidence hardening.

## Verification

Focused resolver/API/UI tests, disposable browser tests, full Jest, typecheck, lint, build, harness, CI, preview, and read-only production reconciliation.
