---
name: zd-field-visits
description: Use for field-visit capture, confirmation, evidence, recovery, or reporting changes.
---
# ZD Field Visits

Required inputs: visit journey, role/segment, online/offline state, evidence state.

Workflow: read contract/scoped guidance; trace local transaction → server confirmation → evidence retry; preserve ID/owner; run field-visit related tests and guard.

Docs: `docs/contracts/field-visits.md`, `src/lib/fieldVisits/AGENTS.md`.

Checks: no delete/clear, confirmed visit survives evidence failure, IST helper, approved route. Required-field upgrades preserve legacy rows and repair the same offline operation ID. Evidence expiry uses only exact authoritative Storage keys and never deletes visits. Distributor `payment_done` remains observational and cannot mutate financial, Pipeline, or Call authority.

Output: changed state transition, authority/recovery impact, tests, and remaining debt.
