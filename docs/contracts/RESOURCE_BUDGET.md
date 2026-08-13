# Resource Budget

## Budgets

| Resource | Target | Warning | Critical | Emergency |
|---|---:|---:|---:|---:|
| Database | <250 MB | >=250 MB | >=350 MB | >=425 MB |
| Storage | <500 MB | >=500 MB | >=700 MB | >=850 MB |
| Uncached egress/month | <2.5 GB | >=2.5 GB | >=3.5 GB | >=4.0 GB |
| Cached egress/month | <2.5 GB | >=2.5 GB | >=3.5 GB | >=4.0 GB |

These are internal release thresholds below the external Free-plan ceilings of 500 MB database, 1 GB Storage, 5 GB uncached egress, and 5 GB cached egress per billing cycle.

## Invariants

- Hot/list reads cannot use `select("*")` without a written architecture exception. Every list/history read uses explicit projections and a bounded page. Evidence, blobs, and relational base64 never enter list hydration.
- New media uses Storage with explicit retention. Permanent business history is never purged or lossily transformed for quota relief.
- Permanent 4xx/business errors terminate and never retry forever. Network, 408, 429, and 5xx failures retry with bounded backoff.
- Hidden pages do no unnecessary polling. Focus, visibility, and online refreshes are deduplicated.
- Realtime is scoped and unsubscribed, and does not duplicate equivalent high-frequency polling.
- Polling below 60 seconds requires explicit architecture approval and tests. Full hydration remains serialized and budgeted.
- Material hot-query or egress growth requires an ExecPlan resource section. Derived projections never become business authority.
- Service-role secrets remain server-only. Existing normalized authority is not duplicated as large text or binary payloads.
- Major screens declare initial request count, page size, polling policy, and binary policy. Distributor Status is one aggregate plus one 50-row list, with no polling or binary hydration.

## Current snapshot

Read-only audit on 2026-08-12: database 28,675,219 bytes; Storage 7,141,529 bytes across 60 objects. Billing-cycle egress remains an owner dashboard check because no Management API secret is stored in the CRM.
