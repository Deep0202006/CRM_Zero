# Calls Custom-Client Confirmation Incident

- **Impact:** free-text client calls could remain locally durable but remotely unconfirmed; FIFO backlog processing delayed new online calls and Admin KPI visibility.
- **Root cause:** arbitrary non-Excel text was interpreted as `lead_id`, conflicting with server UUID validation; legacy repair covered only Excel references; submission awaited the full queue.
- **Data safety:** read-only production audit found zero non-UUID remote lead IDs and zero duplicate log IDs. No production rows were changed. Browser-local stranded rows remain preserved for deterministic retry.
- **Recovery:** canonical free text becomes null `lead_id` plus preserved `client_name`; legacy payloads receive the same repair with their original `log_id`; exact-call priority confirmation uses the existing outbox and approved route.
- **Protection:** Calls contract, critical flow, regression tests, Calls/Incident skills, and lessons ledger updated. A regex invariant guard was explicitly declined because UUID-versus-human identity is a semantic contract better enforced by unit tests.
- **Status:** implemented; verification and release pending.
