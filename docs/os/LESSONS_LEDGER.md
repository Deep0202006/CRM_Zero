# Engineering Lessons Ledger

Record only genuinely new, reusable engineering knowledge from serious incidents. Do not include customer data, credentials, or verbose incident narratives.

| Date | Domain | Symptom | Wrong assumption / missing capability | Permanent lesson | Contract/guard/test/skill updated | Status |
|---|---|---|---|---|---|---|
| 2026-08-10 | Calls | Free-text clients stayed local and new calls waited behind old queue failures. | UI client references, offline repair, and server validation did not share one semantic contract; the outbox lacked exact-item priority confirmation. | UI client-reference semantics, offline payload semantics and server validation must share one canonical contract. Custom user-entered identities must never be silently interpreted as relational UUID identifiers. Critical new work should receive targeted confirmation through its existing durable outbox when backlog order is not a business dependency. | Calls contract and critical flow; client/sync/priority regression tests; Calls and Incident skills. A pattern guard was not suitable for this semantic rule. | Implemented |
