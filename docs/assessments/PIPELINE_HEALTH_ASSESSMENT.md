# Pipeline Health Assessment

Assessment date: 2026-08-10. Risk: R2. Scope: read-only source, history, migration, test, and sanitized production assessment. No lead was created or moved; no production row was inserted, updated, deleted, or repaired.

Evidence labels used below:

- **PROVEN — source:** executable current code or tests.
- **PROVEN — production:** aggregate read-only snapshot; no customer values are included.
- **INFERENCE:** strongly supported but requires deployed function/trigger introspection to prove.
- **UNKNOWN:** unavailable from a root/server audit, especially browser-local Dexie state.

## CURRENT FLOW

1. The Onboarding UI reads leads from Dexie and groups them into hard-coded Retailer or Distributor board stages.
2. A new lead is created locally with a stable UUID, `status = New`, and `assigned_to = current user`, then enters the generic durable sync queue.
3. “Move forward” uses the canonical transition matrix and calls `transitionLead(lead_id, target, local current stage)`.
4. Online, `transitionLead` calls `transition_lead_stage`. On success it updates Dexie. On any RPC error or business rejection it silently converts the transition into a generic queued lead `UPDATE`.
5. Offline, it immediately applies the new status to Dexie and queues the same generic `UPDATE`.
6. Generic queue replay detects a lead status update and calls `transition_lead_stage` with `p_expected_current_stage = null`; after success it removes the queue item. Realtime and pull-down sync avoid replacing a local record while any mutation for that record is pending.
7. Migration text defines a before-update trigger for `stage_entered_at`, a general stage-follow-up task trigger, a Registration checklist trigger that creates four more tasks, and renewal functions/tasks.
8. Manager Funnel reads server views when configured and otherwise computes from Dexie. Admin/KPI call counts use the canonical work-metric classifier, which excludes recognized synthetic stage/audit call outcomes.

Authority today is split: Supabase is intended to be cross-device truth, but a pending local generic stage update suppresses incoming remote reconciliation and can later overwrite that truth.

## PROVEN PROBLEMS

| Priority | Finding | Evidence |
|---|---|---|
| P0 | Stage evidence gates are bypassed. `STAGE_GATES`, modal state, submit handler, and synthetic evidence writer remain, but the normal handler always calls `executeTransition(..., null)`. | **PROVEN — source/history:** commit `8523853` explicitly replaced the gate-opening branch with the direct call while leaving all gate machinery. This is dead/bypassed logic, not a completed removal or documented obsolete design. |
| P0 | An online concurrency conflict or any RPC/schema/network error is converted into delayed success locally. | **PROVEN — source:** `leadStageService.ts` catches every RPC failure/rejection, queues `{ lead_id, status }`, returns success to the UI path, and loses the failure category. |
| P0 | Queue replay disables optimistic concurrency. | **PROVEN — source:** generic lead replay sends `p_expected_current_stage: null`; the migration RPC checks concurrency only when the expected stage is non-null. A stale device can therefore replay an old target over newer server state. |
| P0 | The durable outbox does not preserve transition intent. | **PROVEN — source:** it stores only a generic row patch, not expected stage, target stage, actor, evidence, or conflict policy. The original precondition cannot be reconstructed safely. |
| P0 | The local RPC definition is not a sufficient server authority boundary. | **PROVEN — migration text:** it is `SECURITY DEFINER`; the ownership rejection is commented out; `p_actor` and declared `v_allowed` are unused; no server transition matrix is checked. Client validation alone can be bypassed. Deployment state requires introspection. |
| P0 | The checked-in RPC writes `updated_at`, but production `leads` does not expose that column. | **PROVEN — production/source:** a read-only select returned PostgreSQL `42703` for `leads.updated_at`; migration `020_pipeline_transition.sql` sets it. The deployed function body is unknown, but the repository definition cannot run successfully against the observed table shape as written. |
| P0 | Canonical stage definitions disagree with database definitions. | **PROVEN — source:** TypeScript includes `Renewal Due`; `supabase/schema.sql` defines a seven-value enum without it; no local enum-extension migration was found, while renewal SQL writes `Renewal Due`. Local migrations do not prove deployment. |
| P1 | Board visibility is independent of canonical validity and hides real states. | **PROVEN — source/production:** Retailer shows only New–Registration; Distributor hides Not Interested and Renewal Due; `Renewal Due` is absent from `STAGE_META`. The production snapshot contains one Retailer in Payment, which cannot appear in the normal Retailer columns. |
| P1 | Registration can create an employee task burst. | **PROVEN — migration text:** the general stage trigger creates one follow-up and the Registration trigger creates four document tasks. These are not exact duplicates, but five tasks from one click is overlapping workflow complexity. Deployment needs trigger introspection. |
| P1 | Stage evidence is modeled as a call log, not as transition evidence. | **PROVEN — source:** when gates are used, `executeTransition` creates a synthetic `call_logs` row before attempting the transition. The call confirmation API now rejects synthetic audit calls, so re-enabling gates without redesign would strand those outbox items. |
| P1 | Pipeline tests validate only the in-memory transition matrix. | **PROVEN — tests:** current pipeline coverage does not exercise gate routing, conflict behavior, durable expected stages, RPC authorization/validation, trigger fan-out, board visibility, or reconciliation. |

## DATA INTEGRITY FINDINGS

Sanitized read-only production snapshot at 2026-08-10 13:23 IST (counts can change during normal employee activity):

| Priority | Aggregate finding |
|---|---|
| NO CHANGE | 33 leads; 31 New, 1 Contacted, 1 Payment. No invalid stage values, duplicate primary IDs, null owners, orphan owners, null/future stage timestamps, or stage timestamps before creation. |
| P1 | One normalized business-name + phone duplicate group contains two lead IDs. This is a review candidate only; do not auto-merge or repair it. |
| P1 | Segment/stage visibility mismatch: the Payment lead is a Retailer and is hidden from the Retailer employee board. This is not proof the data is invalid. |
| NO CHANGE | 653 tasks had no null/orphan owners and no orphan related-lead references. Only one task matched a pipeline stage-follow-up prefix, consistent with the single Contacted lead. No duplicate pipeline-task semantic group was observed. |
| NO CHANGE | 2,699 call rows at the final snapshot had no duplicate IDs or orphan lead references. Twelve matched known synthetic stage/audit patterns; zero were dated today in IST. |
| NO CHANGE | Canonical Calls Today and Follow-up Calls logic rejects recognized synthetic audit outcomes before unique-ID counting. Preserve this defense. |
| UNKNOWN | Failed/dead sync entries, repeated queued transitions, stale expected stages, and stale local copies live in employee browsers and cannot be measured from Supabase. A future diagnostic must aggregate metadata locally without uploading customer content. |
| UNKNOWN | Exact deployed RPC body, enum values, triggers, grants, constraints, and cron schedule were not available through the REST read-only snapshot. Read-only catalog introspection is required before any schema plan. |

The 646 records found in broad duplicate task groups are predominantly recurring non-pipeline work and are outside this assessment; they are not evidence of pipeline trigger duplication.

## ROOT CAUSES

- **P0:** A business transition was reduced to a generic row update. That discarded the expected state and made safe offline replay impossible.
- **P0:** Error handling optimized for eventual UI progress by treating conflicts, schema failures, and network failures as equivalent retryable conditions.
- **P0:** Validation exists in TypeScript but is not enforced as one canonical server contract; migration comments promise authorization and transition checks that the function does not implement.
- **P1:** Stage identity, stage visibility, lifecycle state, evidence, and task automation evolved in separate files without a shared segment/view policy.
- **P1:** Historical migrations are layered and internally inconsistent; they are useful evidence, not a deployable description of production.

## EMPLOYEE UX COMPLEXITY

- **P1:** The interface presents one-click “Move forward,” while retaining invisible required-evidence UI. Employees cannot know whether evidence is required.
- **P1:** A locally advanced card can look successful even when the server rejected the transition; another device or Admin may show a different stage.
- **P1:** Hidden later stages make a converted Retailer disappear rather than clearly enter a completed/customer view.
- **P1:** Registration automation may create five separate tasks instead of one guided checklist with a single accountable next action.
- **P2:** Search and board grouping are entirely local; freshness and pending/conflict state are not explained at the lead level.

## MUST FIX

1. **P0 — Replace generic queued status patches with a durable transition command.** Persist stable operation ID, lead ID, expected stage, target stage, actor, evidence (if retained), creation time, and conflict state. Retry the same command; never replay with a null expected stage.
2. **P0 — Treat conflicts as reconciliation, not delayed writes.** Network/unavailable may remain pending; concurrency/authorization/invalid-transition must stop, fetch canonical server state, preserve the local intent for review, and never overwrite automatically.
3. **P0 — Make the server transition endpoint authoritative.** After read-only production introspection, enforce caller ownership/admin authority, canonical from→to rules, actor restrictions, expected-stage comparison, and return the committed canonical row/stage timestamp. Do not rely on client validation or an unused actor argument.
4. **P0 — Reconcile deployed schema before implementation.** Verify enum/check values, RPC definition/grants, `stage_entered_at` trigger, task triggers, and renewal scheduler. Resolve the `updated_at` mismatch and `Renewal Due` mismatch in one explicit R3 plan; do not infer or apply from local migrations.
5. **P0 — Choose and enforce one evidence policy.** Product owner must decide whether transition evidence is required. If yes, open the gate and validate evidence server-side with the transition. If no, remove the dead gate/modal/synthetic-call code. Do not leave optional-looking dead enforcement.
6. **P0 — Keep pipeline audit events out of `call_logs`.** Preserve the existing synthetic-call exclusion for historical defense, but future transitions should use transition-specific audit evidence. Never count a stage event as a genuine call.

## SHOULD FIX

1. **P1 — Define board visibility centrally.** Keep one canonical state machine and separately define which stages are active, completed, lost, or renewal lifecycle views per segment. Every valid record must remain discoverable.
2. **P1 — Simplify Registration work.** Prefer one “Complete registration checklist” task backed by checklist progress, or otherwise prove why five concurrent tasks are required. Give task generation one owner (database or application), with an idempotency key.
3. **P1 — Add transition-focused tests.** Cover online success, network retry, conflict, authorization rejection, stale device replay, exact expected stage, stage timestamp, trigger/task cardinality, Retailer Payment visibility, and synthetic-call metric exclusion.
4. **P1 — Add local pipeline health diagnostics.** Show per-lead pending/conflict state and provide aggregate dead-letter counts without exposing business data. Do not silently hide incoming server updates forever because a stale mutation exists.
5. **P1 — Review the single duplicate-identity group manually and read-only first.** Establish whether it is legitimate before any separately authorized repair task.

## LATER / DO NOT OVERBUILD

- **P2:** Add a compact transition history only if operational audit/recovery needs it; do not build event sourcing for 33 leads.
- **P2:** Add manager aging alerts after `stage_entered_at` and transition authority are proven reliable.
- **NO CHANGE:** Keep stable lead UUIDs, explicit `assigned_to`, Dexie durable recovery, Supabase cross-device authority, canonical work-metric unique-ID counting, and the current genuine-call classifier.
- **NO CHANGE:** Do not auto-merge duplicate identities, normalize historical confirmed rows, or manufacture transitions to fill history.
- **NO CHANGE:** Do not collapse Renewal Due into Payment merely to avoid schema work; decide whether renewal is a lifecycle state, then represent it consistently.

## PROPOSED SIMPLE PIPELINE MODEL

Employee-facing progression:

`New → Contacted → Interested → Registration → Installation → Payment`

Side/lifecycle outcomes:

- `Contacted → Not Interested`; explicit re-engagement returns to Contacted.
- `Payment → Renewal Due` is system-only; renewal returns to Payment, churn goes to Not Interested.

One action means one durable transition command. The server either confirms that exact expected→target transition or returns a typed conflict. Dexie immediately preserves the intent and may optimistically display it as pending, but never calls it confirmed until the server returns the canonical row. Board columns are views over the same stages: active sales, completed customers, lost/re-engage, and renewals. No stage event is a call.

## EXACT FILES/COMPONENTS AFFECTED

Future implementation (not changed by this assessment):

- `src/app/onboarding/page.tsx` — gate decision, board visibility, pending/conflict presentation, synthetic call removal.
- `src/lib/pipelineStages.ts` — canonical stages, transitions, actor rules, centrally exported view metadata.
- `src/lib/validation.ts` — shared transition command and evidence validation.
- `src/lib/leadStageService.ts` — typed confirmation/conflict behavior; no catch-all queue fallback.
- `src/lib/db.ts` — durable transition outbox and safe reconciliation; remove null-expected generic stage replay.
- `src/lib/syncPayload.ts` — transition-command compatibility only if legacy local payload recovery requires it.
- `src/app/manager/kpi/FunnelTab.tsx` and `src/lib/pipelineExport.ts` — consume canonical view/stage semantics and server authority.
- `src/lib/workMetrics/canonical.ts` — retain historical synthetic exclusion; add tests for any legacy patterns discovered.
- `src/lib/taskEngine.ts` / follow-up helpers — verify task ownership boundaries; avoid duplicate automation.
- `supabase/migrations/002_addendum.sql`, `003_pipeline_optimization.sql`, `004_renewal_checklist_rebrand.sql`, `020_pipeline_transition.sql`, `FINAL_CONSOLIDATED_MIGRATION.sql`, and `supabase/schema.sql` — historical evidence to reconcile, not files to apply blindly.
- `src/lib/__tests__/pipelineStages.test.ts` plus new service/outbox/board/task/KPI contract tests.

## RISKS

- **P0:** Changing queue shape without deterministic compatibility can strand offline transitions. Preserve every pending intent and stable ID.
- **P0:** Deploying application logic before the authoritative RPC/schema contract can increase split-brain behavior.
- **P0:** Enabling gates as-is would create synthetic calls rejected by the approved call confirmation API.
- **P1:** Removing stages from boards without a discoverable completed/lost view can make valid leads appear lost.
- **P1:** Trigger changes can duplicate or omit tasks if deployed objects are not introspected first.
- **P1:** Existing browser-local stale transitions are unknown and need a compatibility/reconciliation policy before rollout.

## SAFE IMPLEMENTATION SEQUENCE

1. **P0 / R3:** Perform read-only production catalog introspection: lead type/constraints, columns, RPC body/grants, triggers, functions, task uniqueness, cron. Freeze the exact deployed contract in an ExecPlan.
2. **P0 / R2 design:** Obtain owner decision on evidence requirements and stage/view semantics for Retailer, Distributor, completed customers, lost leads, and renewals.
3. **P0:** Add failing unit/contract tests for expected-stage preservation, conflict classification, authorization, valid transitions, metric isolation, task cardinality, and board discoverability.
4. **P0 / R3:** Introduce the authoritative server transition contract and any minimal schema correction in preview/staging first. No production test leads or mutation-based smoke tests.
5. **P0:** Add a versioned durable transition outbox with compatibility for existing generic lead-status queue items. Legacy items must be surfaced for reconciliation; never replay them with `expected = null`.
6. **P1:** Simplify the UI and task automation against the now-authoritative contract. Remove whichever gate/task path the owner declares obsolete.
7. **P1:** Reconcile employee, second-device, Manager Funnel, export, My Day, and KPI behavior in preview; production verification remains aggregate and read-only.
8. **P1:** Roll out with conflict/dead-letter telemetry and a rollback that preserves local intents. Handle the duplicate-identity candidate only in a separate explicitly authorized data task.

