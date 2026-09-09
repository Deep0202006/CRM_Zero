# Follow-ups Contract

## CURRENT

Follow-ups are derived from scheduled call/visit work and their confirmed source records. Employee views are self-scoped; compatible historical records are preserved.

## INVARIANT

Do not fabricate completion. Attribution uses explicit owner and stable source IDs. Editing a source Call keeps exactly one active current follow-up intent when required, deactivates obsolete active intent through Task lifecycle fields without deletion, and never rewrites completed history. Unknown/legacy records are preserved rather than guessed.

An explicit Create Task action from Pipeline writes one ordinary Task with exact `related_lead_id`. Its deterministic same-user, same-Lead, same-IST-day UUID and outbox key make retries and double-clicks converge; a later day remains a new explicit action. Stage movement never creates a Task. My Day focus priority is derived at read time from existing Task facts and deterministic P0/P1/P2 reason codes; an exact follow-up due today is P0, and no focus rows or scores are created.

My Day consumes real assigned tasks in Overdue / Today / Later / Done views
using exact date/status fields. Later includes actual active future-due records
through the existing loader's opt-in; its default remains compatible. Genuine
lead-linked tasks are retained while Pipeline-derived lead signals, exports and
weekly digests are not consumed on My Day. Internal priority identifiers remain
available in the task-only daily-summary contract; the UI uses plain due labels.
Pending/In Progress keep their existing Done and authorized Delete actions;
Missed remains read-only. Completion identities, outcome confirmation, source
deduplication and durable offline recovery are unchanged.

## KNOWN DEBT

Multiple historical source shapes require reconciliation logic.

Primary tests: `followUpContract`, `followUpForensicRepair`, `fieldVisitPaymentFollowUp`.
