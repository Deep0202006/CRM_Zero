# Pipeline Contract

## CURRENT

- Supabase-confirmed lead rows are cross-device authority online. Dexie is durable offline/cache state for pending creations and transition intents.
- Only Pipeline Create Lead may create an authoritative Lead. Current and previous durable create payloads converge on `pipeline_create_lead_v1`; authenticated direct inserts are denied and guarded at the table boundary.
- Every active authenticated CRM user can read both segment boards through bounded server pages of at most 50 rows.
- Only the lead's `assigned_to` user receives employee transition controls. Admin has no automatic override.
- `assigned_to` resolves to `users.name`; UUIDs are not owner labels.
- Retailer stages exclude Payment and terminate at Converted. Distributor retains Payment and does not use Converted.
- Common employee matrix: New→Contacted; Contacted→Interested or Not Interested; Interested→Registration; Not Interested→Contacted; Registration→Installation. Retailer: Installation/Renewal Due→Converted, and Renewal Due→Not Interested. Distributor: Installation/Renewal Due→Payment, and Renewal Due→Not Interested. Payment→Renewal Due is Distributor system-only.

## INVARIANT

- Preserve stable `lead_id` and transition `operation_id` through retry.
- Preserve stable create `operation_id`, `lead_id`, actor, payload and capture time through retry. The server freezes actor, New stage, assignment and Pipeline origin.
- Duplicate prevention uses deterministic normalized business-name/phone and business-name/area/segment identities, transaction locks, and every historical stage including Converted. Similar-but-different businesses remain distinct; historical duplicates are never automatically merged, deleted or rewritten.
- Calls, Field Visits, Attendance, Payments, Tasks, Distributor Status, Renewals, My Day, Mapping and Onboarding side effects outside Pipeline may not create Leads. Mapping can reference only an existing exact Lead identity.
- A command preserves authenticated actor, expected stage, and target stage. Generic row patches are not transition commands; employee replay never sends a null expected stage.
- The server atomically checks active identity, assigned ownership, expected stage, exact target, actor-specific matrix, and operation identity.
- Conflict never overwrites. Server-confirmed stage wins; attempted intent remains diagnosable until reconciled.
- Online visible Pipeline = confirmed authorized-segment rows + safe current-user pending creations, deduplicated by `lead_id` with server precedence.
- Offline mode keeps confirmed cache visible and labels pending targets; pending is never presented as confirmed.
- Legacy queued status patches are preserved, never guessed/replayed/deleted, and do not block authoritative cache reconciliation.
- Every valid frozen stage remains discoverable. Unknown legacy state is preserved rather than coerced.
- Visibility does not grant mutation authority: all active users read all Leads, while assigned-owner-only transition authority remains unchanged and Admin has no implicit override.
- Pipeline transitions never create genuine `call_logs`; historical synthetic-call metric exclusions remain.
- Pipeline transitions create no employee Task/follow-up/notification or cross-domain write. Calls create neither Leads nor Pipeline transitions.
- A bounded daily server-only renewal processor moves only due Distributor Payment leads to Renewal Due, records an actorless system audit, and creates no employee work or cross-domain rows.
- Admin normal actions require assignment exactly like every other active user. Reassignment, if introduced, is a separate administrative operation.
- Hot reads use explicit columns, stable ordering, one owner-name projection, and server pagination capped at 50.
- Initial Pipeline navigation performs one bounded Lead API request for the selected segment, does not poll, performs no per-stage/per-owner read, and never uses the full-workspace hydration loop. An online API failure is an explicit error, not a successful empty/local-only result.
- A valid owner record has no per-card warning. Read-only cards are quiet. Pending transitions may show pending state; conflicts and preserved recovery evidence surface once as actionable state and genuine server failures are never hidden.
- Creation writes only `leads` and `pipeline_create_operations`. Stage transitions write only Lead stage metadata and `pipeline_transition_operations`; cross-domain deltas remain zero.
- Production verification is read-only by default; migrations require explicit approval.
- A local-first to server-authority switch explicitly reconciles preserved durable local business state.
- Legacy stages may be recovered only from an owner-matched, ordered, complete canonical command chain whose final target matches the preserved local lead.
- Incomplete intent and weak lifecycle signals never become guessed server state. Newer confirmed/semantic work outranks legacy evidence.
- Recovery uses canonical v2 transitions with historical UUID operation identity where available; conflict stops the chain.
- Original recovery evidence remains preserved and becomes passive after recovery, satisfaction, quarantine, or review.

## PIPELINE CONSTITUTION

1. All active CRM users and Admin can read all Leads; visibility never grants mutation authority.
2. Only canonical Pipeline Create Lead creates authoritative Leads.
3. Converted Leads remain visible and participate in duplicate prevention.
4. Duplicate prevention is deterministic, race-safe and idempotent; production history is never auto-merged or deleted.
5. Stage transitions use the single canonical segment-aware contract and require assigned ownership plus expected stage.
6. Successful create and transition commands require server write-to-read closure for every authorized viewer.
7. False warnings are defects; genuine authorization, conflict, validation and server errors stay explicit.
8. Pipeline mutations create no Task, Call, Visit, Attendance, financial, Distributor, renewal or chat side effect.

## RELEASE DEPENDENCY

- Owner must apply migrations 037 then 038 before this application release; Codex must not apply them.
- Browser-local evidence cannot be remotely enumerated; a browser/device that no longer has it cannot reconstruct it.
- Automatic legacy replay remains disabled because preserved browser evidence can be incomplete; review is safer than guessed mutation.
- Migration 043 must be owner-applied once before the canonical creation application release; the exact pure-SQL precheck/migration/postcheck artifacts are the handoff surface.
