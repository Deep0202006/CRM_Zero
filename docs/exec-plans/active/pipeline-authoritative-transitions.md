# Execution Plan: Pipeline authoritative transitions

## Goal

Make the employee Pipeline simple and cross-device consistent by using server-confirmed leads as online authority and one durable, owner-only semantic transition command.

## Non-goals

- No production mutation or migration application.
- No historical lead normalization, duplicate merge, assignment change, task deletion, or fabricated history.
- No new evidence form, drag-and-drop workflow, event-sourcing system, or Admin transition override.
- No repair of the duplicate lead candidate identified by the assessment.

## Current state

- The board reads Dexie as authority and hides some valid frozen stages.
- Transition failures fall back to generic lead status updates; replay drops the expected stage.
- Dead evidence-gate code can create synthetic call rows.
- The checked-in RPC does not prove the deployed contract and does not enforce the frozen owner rule.
- The Pipeline harness mapping omits the real `src/app/onboarding/` surface.

## Invariants

- The exact stages are New, Contacted, Interested, Not Interested, Registration, Installation, Payment, and Renewal Due.
- Stable lead and operation IDs survive retry.
- Only the assigned user performs an employee transition; Payment to Renewal Due is system-only.
- Server-confirmed rows win online; durable local pending work remains visible and is never deleted speculatively.
- Expected and target stages are mandatory; conflicts reconcile and never overwrite.
- Legacy generic status queue entries are preserved and never replayed with a null expected stage.
- Pipeline events never become genuine calls.
- Existing segment visibility remains unchanged.

## Affected domains

- Pipeline: read authority, transition contract/outbox, UI, tests, contract, and skill.
- Auth: existing identity/capability information is consumed, not redesigned.
- Supabase: a review-only migration may define the authoritative transition boundary.

## Implementation steps

1. Correct harness coverage and establish focused tests for frozen stages, transition semantics, authorization, read merging, and legacy recovery.
2. Complete sanitized read-only production introspection; record proven facts and UNKNOWNs.
3. Implement a shared Pipeline contract, server-authoritative repository/read route, and deterministic local merge.
4. Implement the semantic durable transition command, typed outcomes, exact confirmation, conflict reconciliation, and safe legacy queue classification.
5. Simplify the Onboarding UI to eight discoverable stages, human owner names, exact actions, and pending/conflict states; remove dead gates and synthetic-call creation.
6. Prepare the minimum non-destructive server-authority migration and rollout/rollback review; do not apply it.
7. Update the durable Pipeline contract, skill, harness test selection, and justified learning entry.
8. Run R3 verification and adversarial review; fix all P0/P1 findings; prepare a draft PR without merge or deployment.

## Verification

- Harness preflight, scope, invariant, docs, related tests, and R3 verify.
- Focused Pipeline contract/repository/outbox/authorization/migration/UI tests.
- Full Jest, typecheck, lint, production build, and `git diff --check`.
- Static production-safety checks and actual-diff adversarial review.
- GitHub CI and Vercel preview status when available.

## Production safety

- [ ] Production mutation explicitly authorized or not applicable
- [ ] Schema/RLS impact explicitly authorized or not applicable
- [x] Read-only audit completed where production state matters
- [x] Secrets and production connections excluded from CI/local tests

Migration application and production business writes are not authorized. Read-only aggregate introspection is the only permitted production access.

## Rollback

Revert the application commit and retain all local transition intents. If later authorized and deployed, roll back the server function/guard only through the reviewed companion procedure; never rewrite lead rows or clear local queues.

## Decision log

- 2026-08-10: Classified R3 because the authoritative transition boundary requires database function/permission protection.
- 2026-08-10: Owner decisions freeze eight stage labels, current effective segment access, and assigned-user-only employee transitions.
- 2026-08-10: Existing generic status intents cannot recover a trustworthy expected stage; preserve and classify them instead of guessing.

## Progress

- [x] Branch created from latest `origin/main` (`1fde0a8917def965c7d9e490d9ad3a6544e6afa4`).
- [x] Task manifest and active ExecPlan created.
- [x] Read-only production introspection completed; catalog-only details remain explicitly UNKNOWN.
- [x] Focused tests added (86 Pipeline assertions).
- [x] Application and review-only migration implementation completed.
- [x] R3 verification completed (41 suites / 270 tests; typecheck, lint, build, scope, invariant, and docs passed).
- [x] Adversarial review completed; P1 findings fixed.
- [ ] Draft PR prepared.

## Self-review

- **P0:** None remaining in the implemented application boundary.
- **P1 fixed:** concurrent duplicate operation retry could have produced a false conflict; added an advisory transaction lock.
- **P1 fixed:** non-retryable authorization/transition failures could be blindly retried; retry now permits only unavailable/configuration failures.
- **P1 fixed:** a legacy status item containing unrelated lead fields could strand those fields; the original item is preserved while a one-time non-status copy follows ordinary sync.
- **P1 fixed:** another client's confirmed transition depended on focus/refresh; Realtime now signals an authoritative refetch.
- **P2:** Existing repository lint warnings remain outside this diff; no new lint error was introduced.
- **Residual R3 risk:** deployed catalog policies, trigger bodies/grants, renewal execution context, and SQL execution compatibility remain unproven. Migration approval/deployment is blocked until the documented read-only catalog review.
