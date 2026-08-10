# Pipeline pre-032 stage recovery

## Employee impact

After PR #20 promoted Supabase-confirmed leads to online board authority, some employees could see an earlier stage than the later stage previously shown by their browser-local Pipeline. All eight columns were also difficult to navigate because the horizontal scrollbar could sit below a tall page.

## Proven cause and migration distinction

Before PR #20, `transactionalMutation("leads", "UPDATE", { lead_id, status })` atomically changed Dexie and added a distinct UUID-keyed, timestamped queue item. Failed/offline transitions therefore appeared advanced locally even when Supabase remained earlier. PR #20 displayed server authority and preserved/quarantined those unsafe generic patches. That authority reconciliation exposed the disagreement.

Migration 032 is deployed, but its SQL contains no mass existing-lead status update. Read-only evidence confirms the eight-value enum and v2 operation ledger. The apparent reset is not evidence that migration 032 rewrote lead rows.

## Recovery confidence and mechanism

The planner sorts owner-scoped legacy items by timestamp and numeric ID, collapses only consecutive duplicate targets, requires valid frozen stages, matching local owner/final state, no current semantic command or unrelated post-032 operation, and a complete canonical chain from current server stage. A single New→Installation target is review-required, never inferred.

Eligible recovery reuses the historical UUID as `operation_id` and calls v2 one exact expected→target step at a time. Conflict stops the sequence. Original queue evidence receives passive state/reason/time metadata and is never deleted or rewritten.

## Side-effect safety

Sanitized production audit found 40 v2 operations, 73 Pipeline-task rows, eight registration checklist rows, and historical SQL capable of non-idempotent generic/Registration task fan-out. Deployed trigger bodies were unavailable through read-only catalog access. Therefore the server currently advertises no safe auto-replay targets: otherwise high-confidence chains are passively marked review-required until side-effect idempotency is proven. Weak checklist, installation, payment, task, call, `stage_entered_at`, or `onboarded_at` signals never establish an exact stage alone.

Lower-stage leads with `onboarded_at`: New 1; Contacted 1; Interested 0; Not Interested 0; Registration 0. No automatic repair was made from these signals.

## All-user/browser limitation

Browser-local queues cannot be enumerated centrally. Recovery evaluates when the assigned employee opens Pipeline on the browser retaining evidence. A lost/replaced browser with no preserved evidence cannot reconstruct its old local stage. Other authorized users and Admin converge only after canonical server confirmation.

## Data safety and scrolling repair

No lead, queue item, call, task, checklist, or browser database is deleted; no ID changes and no dummy production record is created. Passive artifacts stop warnings, active-outbox lock retention, and pull/Realtime blocking while remaining inspectable.

The board now owns a focusable, viewport-bounded native horizontal scroller; all eight 292px columns remain readable, each column owns vertical scrolling, and cards are contained without global overflow changes.

## Regression protection

Focused tests cover chain reconstruction, partial prefixes, ownership, invalid/missing hops, newer work, historical IDs, conflict stop, side-effect gating, evidence preservation/passivity, sync/Realtime/lock behavior, destructive-path absence, and board containment/accessibility.
