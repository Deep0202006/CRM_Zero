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

## KNOWN DEBT

- Deployed policies, trigger bodies/grants, and renewal job require catalog-level read-only verification before migration approval.
- Browser-local legacy status intents require reconciliation; their missing expected stage cannot be reconstructed safely.
- Registration task fan-out remains until deployed trigger ownership and business policy are separately proven.
