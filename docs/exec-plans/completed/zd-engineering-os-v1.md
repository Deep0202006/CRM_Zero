# Execution Plan: ZD Engineering OS V1

## Goal

Install a repository-native, progressively disclosed engineering harness without changing CRM behavior.

## Non-goals

No product feature, production data, schema, RLS, auth, API contract, or deployment behavior changes.

## Current state

The pinned production baseline had a minimal root instruction, fragmented reliability knowledge, broad tests, and no task/risk-aware mechanical harness.

## Invariants

Golden principles apply, especially zero deletion/clearing, stable IDs, server authority, local recovery, server-only secrets, and unchanged business behavior.

## Affected domains

Governance coverage spans all configured domains; implementation changes are limited to documentation, skills, harness scripts/config, CI, and templates.

## Implementation steps

1. Audit current instructions, code boundaries, tests, and reliability history.
2. Create the documentation OS, contracts, scoped instructions, and skills.
3. Implement configuration, scripts, generated map, tests, PR template, and CI.
4. Validate negative/positive harness scenarios and full CRM gates.
5. Adversarially review, commit, push, and open a PR.

## Verification

Harness self-tests, scope, invariant, docs, TypeScript, full Jest, ESLint, Next build, and `git diff --check`.

## Production safety

- [x] No production mutation authorized or performed.
- [x] No schema/RLS change.
- [x] No production credentials or live connections used.
- [x] Existing application source behavior unchanged.

## Rollback

Revert the harness commit/PR; product implementation remains at the pinned baseline.

## Decision log

- Classified R2 because the harness governs critical APIs/synchronization but does not alter them.
- Used differential executable-source scanning to reduce false positives.
- Preserved pre-existing untracked user artifacts via runtime baseline scope.
- Added CI base-branch comparison so guards work in clean PR checkouts.
- Normalized the existing lockfile for reproducible `npm ci` and used Node 22 to satisfy installed SDK engine requirements.

## Progress

Implementation and local verification completed; PR delivery pending.
