# Follow-ups Contract

## CURRENT

Follow-ups are derived from scheduled call/visit work and their confirmed source records. Employee views are self-scoped; compatible historical records are preserved.

## INVARIANT

Do not fabricate completion. Attribution uses explicit owner and stable source IDs. Editing a source Call keeps exactly one active current follow-up intent when required, deactivates obsolete active intent through Task lifecycle fields without deletion, and never rewrites completed history. Unknown/legacy records are preserved rather than guessed.

An explicit Create Task action from Pipeline writes one ordinary Task with exact `related_lead_id`. Stage movement never creates a Task. My Day focus priority is derived at read time from existing Task facts and deterministic reasons; it creates no focus rows or scores.

## KNOWN DEBT

Multiple historical source shapes require reconciliation logic.

Primary tests: `followUpContract`, `followUpForensicRepair`, `fieldVisitPaymentFollowUp`.
