# Follow-ups Contract

## CURRENT

Follow-ups are derived from scheduled call/visit work and their confirmed source records. Employee views are self-scoped; compatible historical records are preserved.

## INVARIANT

Do not fabricate completion. Attribution uses explicit owner and stable source IDs. Unknown/legacy records are preserved rather than guessed.

## KNOWN DEBT

Multiple historical source shapes require reconciliation logic.

Primary tests: `followUpContract`, `followUpForensicRepair`, `fieldVisitPaymentFollowUp`.
