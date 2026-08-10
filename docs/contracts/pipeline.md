# Pipeline Contract

## CURRENT

- Supabase-confirmed lead rows are cross-device authority online. Dexie is durable offline/cache state for pending creations and transition intents.
- Segment access derives from existing `ret_onboarding`, `dist_onboarding`, and Admin capabilities. Equivalent authorized users consume the same confirmed segment rows.
- Only the lead's `assigned_to` user receives employee transition controls. Admin has no automatic override.
- `assigned_to` resolves to `users.name`; UUIDs are not owner labels.
- Frozen ordered stages: New, Contacted, Interested, Not Interested, Registration, Installation, Payment, Renewal Due.
- Employee matrix: New→Contacted; Contacted→Interested or Not Interested; Interested→Registration; Not Interested→Contacted; Registration→Installation; Installation→Payment; Renewal Due→Payment or Not Interested. Payment→Renewal Due is system-only.

## INVARIANT

- Preserve stable `lead_id` and transition `operation_id` through retry.
- A command preserves authenticated actor, expected stage, and target stage. Generic row patches are not transition commands; employee replay never sends a null expected stage.
- The server atomically checks active identity, assigned ownership, expected stage, exact target, actor-specific matrix, and operation identity.
- Conflict never overwrites. Server-confirmed stage wins; attempted intent remains diagnosable until reconciled.
- Online visible Pipeline = confirmed authorized-segment rows + safe current-user pending creations, deduplicated by `lead_id` with server precedence.
- Offline mode keeps confirmed cache visible and labels pending targets; pending is never presented as confirmed.
- Legacy queued status patches are preserved, never guessed/replayed/deleted, and do not block authoritative cache reconciliation.
- Every valid frozen stage remains discoverable. Unknown legacy state is preserved rather than coerced.
- Pipeline transitions never create genuine `call_logs`; historical synthetic-call metric exclusions remain.
- Production verification is read-only by default; migrations require explicit approval.
- A local-first to server-authority switch explicitly reconciles preserved durable local business state.
- Legacy stages may be recovered only from an owner-matched, ordered, complete canonical command chain whose final target matches the preserved local lead.
- Incomplete intent and weak lifecycle signals never become guessed server state. Newer confirmed/semantic work outranks legacy evidence.
- Recovery uses canonical v2 transitions with historical UUID operation identity where available; conflict stops the chain.
- Original recovery evidence remains preserved and becomes passive after recovery, satisfaction, quarantine, or review.

## KNOWN DEBT

- Deployed policies, trigger bodies/grants, and renewal job require catalog-level read-only verification before migration approval.
- Browser-local evidence cannot be remotely enumerated; a browser/device that no longer has it cannot reconstruct it.
- Deployed status-trigger idempotency remains unproven. Historical SQL can create generic and registration tasks, so automatic legacy replay is disabled until replay side effects are proven safe.
