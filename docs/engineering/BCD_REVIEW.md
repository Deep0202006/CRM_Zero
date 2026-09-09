# B–D continuation — implementation in progress

Task `20260909-cb00d222890d`; baseline PR113 merge
`9c5f851ba93ef14a9e5f294d4b83300d38a34462`. The corrected Owner master
requires CI-only disposable PostgreSQL verification. No local database software,
production connection, production SQL application or merge is authorized.

## Smallest read slice

| Source / authority | Metric or scope | Consumer | Required proof |
|---|---|---|---|
| `field_visits.visit_id`, immutable `user_id`, canonical `visit_date` | Retained Visit count, daily/outcome/representative partition; check-in/date mismatch separately | Authorized `/api/admin/visits/analysis`; page integration pending | `field-visits-unit`, `bcd-readers-postgres`; rendered acceptance pending |
| Existing `users` profile and `leads` business fields joined safely through text Visit lead reference | Literal per-field search, selected immutable representative | Same read predicate; register/picker integration pending | >50 matches, inactive identity, legacy non-UUID lead fixtures; CI pending |
| Installed Supabase SDK transport | 24 reader calls, separate 2 authorization database calls, 8-second deadline, retry disabled, charged empty EOF | One report-local resource | Real SDK with controlled fetch responses; real PostgREST HTTP verification pending |
| Existing create-user/update-user and employee directory tests | Public-profile name/email/active ownership is separate from Auth login identity | Registry reconciliation only | Impact and registered control proofs |

The current SQL is a stable, security-invoker, service-executable-only read
function. It returns at most 1,000 scalar event rows per call. The caller follows
the last actually received key through an empty EOF, with a 20,000-row ceiling.
A short response is not evidence of source exhaustion. Failed reads withhold
aggregates. Results explicitly describe bounded live multi-request consistency
and uncertified historical coverage, not an atomic historical ledger.

The script reuses tracked schema/migration definitions as registered proof
inputs. New fixture inserts list their columns explicitly. No fixture-only
authority or parser exception is introduced. ERP observation selectors are
narrowed to their documented two fields, and existing public-profile ownership
is registered without granting deletion or authentication authority.

## Review findings carried forward

Architecture/data review: match search fields separately; preserve legacy text
lead references; require actual service execution and public-role denial; prove
pagination under an HTTP row cap. DDL statement timeout is **not** an RPC runtime
timeout. The analytical function now declares 7 seconds for PostgREST timeout
hoisting. A pinned temporary PostgREST v13.0.7 GitHub-only fixture verifies actual
HTTP row caps, public-role denial and timeout hoisting; execution remains pending
CI. Its pin is not a production-version parity claim. Auth transport cancellation
and complete physical-request accounting remain final integration requirements.

Prior source discovery remains in the durable task packet: Mapping completion
is a currently retained lifecycle snapshot (migration 054), not permanent event
credit. Team reference cohort must remain stable. Pipeline event filtering must
precede sampling, overdue/context checks must not silently exhaust candidate
caps, and durations require verified ordered transitions. My Day self-history
must not invoke Team or Pipeline loaders. Preserve all confirmation/offline
paths and exact identities.

## Delivery acceptance (not complete)

| Packet | Status |
|---|---|
| B Visits range, joined register search, historical picker, applied scope | Initial SQL/API slice only; integration and visual acceptance pending |
| C typed Team history and filtered Pipeline inspection/context | Pending implementation |
| D self-scoped My Day history and lazy Admin task/target review | Pending implementation |
| Physical PostgREST requests, rendered screenshots, exact final-head CI | Pending; no local SQL PASS claimed |

This document is source-review context, not proof. A draft PR is for early
database verification; it must not be declared manual-merge ready until every
packet and required final-head check is complete. Final Owner activation
instructions will identify the reviewed SQL and safe pre/postchecks. Production
application remains Owner-only.
