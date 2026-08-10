# Execution Plan: Pre-032 Pipeline stage recovery and board containment

## Goal

Automatically restore only provable pre-PR20 employee stage sequences through the approved v2 transition boundary, preserve every recovery artifact, and keep all eight board columns accessible within the working viewport.

## Non-goals

- No broad SQL update, guessed stage, queue deletion, browser reset, lead recreation, duplicate merge, fake history, or production test record.
- No migration 032 reapplication or rollback and no stage-name, segment-visibility, or owner-transition policy change.
- No automatic recovery from weak lifecycle signals or a single non-adjacent target.

## Current state

- Pre-PR20 generic lead updates changed Dexie immediately and persisted distinct timestamped UUID queue evidence, so local stage could advance while Supabase stayed earlier.
- PR20 promoted server-confirmed rows to online authority and quarantined generic status updates. Preserved local intent may therefore appear to have reset even though migration 032 did not rewrite rows.
- The eight-column track can place its horizontal scrollbar below a tall page instead of inside the visible board workspace.

## Invariants

- Exact eight stages and canonical employee matrix remain frozen.
- Only the authenticated `assigned_to` owner can recover or normally transition.
- Auto-recovery requires a complete valid sequence, matching local final state, matching ownership, no newer semantic work, and proven-safe transition side effects.
- Recovery uses exact expected/target stages and stable historical UUID operation identities.
- Conflict stops the chain. Server authority and newer work always win.
- Original evidence and business records are never deleted or destructively rewritten.
- Ambiguous evidence remains passive and reviewable without technical employee alarms or active-outbox lock retention.

## Affected domains

- Pipeline recovery planner/executor, queue metadata, authoritative refresh, board layout, focused tests, contract, skill, incident, and lesson.
- Supabase is inspected read-only; approved v2 transitions are the only permitted eventual production mutation mechanism.

## Implementation steps

1. Prove pre-PR20 local mutation/queue behavior from source history and inspect current merged implementation.
2. Run sanitized read-only production evidence and side-effect audits; disable auto-replay unless side-effect safety is proven.
3. Add pure legacy sequence planner and passive recovery metadata model with comprehensive tests.
4. Integrate automatic owner-browser recovery after authoritative snapshot, one canonical v2 step at a time, stopping on conflict.
5. Exclude passive artifacts from employee warnings, active counts/locks, pull-down and Realtime blocking without deleting evidence.
6. Contain the eight-stage board in an accessible viewport-bounded horizontal scroller with per-stage vertical lists.
7. Update incident, contract, skill, and one non-duplicative lesson.
8. Run complete R3 verification and actual-diff adversarial review; prepare draft PR without merge.

## Verification

- Focused planner/executor/passive-queue/UI tests, related tests, full Jest, typecheck, lint, build.
- Harness preflight/scope/invariant/docs/R3 verify and `git diff --check`.
- Sanitized read-only production aggregates only; no mutation-based QA.
- GitHub CI and Vercel preview when available.

## Production safety

- [x] Production mutation explicitly authorized or not applicable
- [x] Schema/RLS impact explicitly authorized or not applicable
- [x] Read-only audit completed where production state matters
- [x] Secrets and production connections excluded from CI/local tests

Owner authorizes only evidence-backed owner transitions meeting every high-confidence invariant. Implementation and tests will not execute production recovery. Migration 032 will not be reapplied or rolled back.

## Rollback

Revert the application commit. Preserve all legacy and semantic queue evidence. Any already confirmed recovery transition remains legitimate server history and is not reversed automatically.

## Decision log

- 2026-08-10: R3 because durable browser recovery may invoke real canonical transitions after release.
- 2026-08-10: Migration 032 is confirmed applied; it contains no mass lead-stage rewrite.
- 2026-08-10: Weak server-side lifecycle signals may support review but never establish an exact prior stage alone.
- 2026-08-10: Expanded scope to the existing Pipeline read API for post-032 operation evidence and to AuthContext for passive-only outbox-lock accounting; no authorization semantics change.
- 2026-08-10: Updated the migration review status because owner confirmation and deployed read-only evidence supersede its pre-deployment gate text.
- 2026-08-10: Added focused recovery and scrolling tests to Pipeline harness selection and regenerated the safe repository map.
- 2026-08-10: Kept `safe_replay_targets` empty because deployed trigger/function bodies were not safely introspectable and checked-in history contains non-idempotent task fan-out. Provable chains are preserved as passive review evidence until that side-effect boundary is proven safe.

## Self-review

- P0 fixed: optional recovery-ledger failure can no longer suppress an otherwise successful authoritative Pipeline read.
- P0 fixed: browser recovery-runtime failure can no longer suppress successfully fetched server leads.
- P1 fixed: duplicate historical operation IDs, malformed timestamps, and ledger/server contradictions are classified for review instead of replay.
- P1 fixed: passive evidence no longer blocks pull-down, Realtime, active counts, or user ownership while genuine queued work retains all protections.
- P1 fixed: the board owns visible horizontal overflow, fixed-width columns, and per-column vertical scrolling without changing global overflow.
- Residual: automatic production replay remains deliberately disabled until deployed transition side effects are proven idempotent; browser-local evidence cannot be centrally enumerated.

## Progress

- [x] Branch created from latest `origin/main` (`537b64e101c79431df5e463a40f950f1bbb54dff`).
- [x] Manifest and active ExecPlan created.
- [x] Source-history and production read-only audits complete.
- [x] Planner, integration, passive evidence, and scroller implemented; automatic mutation is side-effect gated off in the deployed policy response.
- [x] Verification and adversarial review complete (19/182 related; 43/295 full; typecheck, lint, build, scope, invariant, docs, and diff checks passed).
- [ ] Draft PR prepared.
