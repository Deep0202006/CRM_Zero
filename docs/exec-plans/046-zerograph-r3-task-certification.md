# Execution Plan: ZeroGraph R3 task certification recovery

## Goal

Repair the engineering-control certification path so repository health cannot certify an incomplete Owner task.

## Non-goals

No CRM runtime, migration, Supabase, appliance, production, or hook-definition changes.

## Current state

The stop hook bypasses work after an active continuation; remote evidence lacks plan binding; OS acceptance contains task residue; legacy discovery is branch-sensitive.

## Invariants

Task acceptance is authoritative for R3; exact remote evidence binds head/tree/plan; only explicit external inaccessibility is external dependency; legacy corpus remains frozen in ordinary CI.

## Affected domains

engineering-control, platform-handover certification policy.

## Implementation steps

1. Repair stop evaluation and its finite-stall regressions.
2. Add task contracts, immutable baseline checks, and task-close integration.
3. Add exact-head remote certification and CI enforcement.
4. Freeze legacy inputs and add regression fixtures.

## Verification

Run the requested engineering, quality, type, unit, lint, and build gates, then exact-head remote certification after push.

## Production safety

- [x] Production mutation not applicable
- [x] Schema/RLS impact not applicable
- [x] Read-only local repository audit only
- [x] Secrets and production connections excluded

## Rollback

Revert this isolated control-plane PR; no production state is changed.

## Decision log

Use the existing plain Node scripts and Jest fixtures; no new dependencies or services.

## Progress

Active.
