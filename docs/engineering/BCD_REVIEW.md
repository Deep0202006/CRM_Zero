# B–D continuation — implementation in progress

Task `20260909-cb00d222890d`; baseline PR113 merge
`9c5f851ba93ef14a9e5f294d4b83300d38a34462`. The corrected Owner master
requires CI-only disposable PostgreSQL verification. No local database software,
production connection, production SQL application or merge is authorized.

## Smallest read slice

| Source / authority | Metric or scope | Consumer | Required proof |
|---|---|---|---|
| `field_visits.visit_id`, immutable `user_id`, canonical `visit_date` | Retained Visit count, daily/outcome/representative partition; check-in/date mismatch separately | Authorized `/api/admin/visits/analysis`; page integration pending | `field-visits-unit`, `bcd-readers-postgres`; rendered acceptance pending |
| Existing `users` profile and `leads` business fields joined safely through text Visit lead reference | Literal per-field search, selected immutable representative | Shared register/events predicate; independent lazy picker integrated | >50 matches, inactive identity, legacy non-UUID lead fixtures; CI pending |
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

PR114 correction batch: exact `http.mjs` safety registration, neighboring-path
denial regression, conditional PostgreSQL 17.6 loopback service in the existing
CI job, host-tool/readiness checks, and report-scoped Auth cancellation. Existing
default backend clients and confirmation retry policy are unchanged. The scoped
transport permits at most 1 Auth HTTP + 2 authorization DB HTTP + 24 report DB
HTTP attempts (27 end-to-end). Every DB read receives a single-use allowance;
SDK retries cannot obtain another physical attempt. Parsed-data accounting is
named `decoded_data_bytes`, not wire bytes, and excludes Auth/error bodies.

The CI SQL fixture now includes tracked019 indexes and catalog assertions for
extracted columns, FK and RLS. Its 20,000 out-of-range plan-only records are
separate from the 1,063-row HTTP range. The harness extracts the real inner
SELECT, binds typed parameters, checks source/RPC agreement and records actual
EXPLAIN ANALYZE BUFFERS plans for dates, representative and literal search.
Plans and runtime results remain pending CI; no candidate index is justified
merely by LIMIT. Historical outcome rows intentionally model pre-constraint
data; this reduced read fixture is not proof of every production write rule.

Production migrations remain Owner-manual in Supabase SQL Editor. Prepared,
CI-tested, Owner-applied and Production-verified are separate states. The ledger
is unchanged at54/54. The final complete migration/precheck/postcheck/hash packet
must be ready before asking for any Owner production action.

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

### Applied-query continuation and observed CI

Owner publication was verified at `12801f15cbd87a87f3a67daf7cf78542b595c1ab`.
CI run `34347750976` passed its planned unit step, then failed the handover
proof because `scripts/bcd-db/schema.sql` matched the protected database-export
filename guard. This is an internal fixture naming defect, not leaked production
data or a missing Owner certificate. The fixture is now `synthetic-schema.sql`,
with its exact runner/proof references updated. The handover guard is unchanged;
its registered check passed locally after this correction. SQL/HTTP execution
was skipped by that CI failure and remains required, pending the next head.

Visits now uses an explicit native Apply form, a captured applied query/page,
and a separate attempted request. Failed Apply from page2 retries page1 of the
attempt, while Previous/Next continue the old applied query. Draft typing sends
no request. Background visibility/realtime refresh cannot cancel a pending
Apply or replace a failed request's Retry. Register, ERP and export work are
cancelled on workspace unmount; the workspace is keyed by authenticated UUID.
Export captures applied filters before awaiting, validates the session actor,
and cannot trigger a download after unmount even if transport ignores abort.
The default register range is seven IST business dates; legacy date mode remains
explicitly separate. This does not yet replace the legacy server search/picker.

Independent review identified the background-refresh and export races; both
were corrected with browser regressions. The registered workspace browser proof
passed locally with one worker on the built synthetic runtime (receipt
`adcaac1942598a245f5e07a12c4749602ba54335d42b6b811be9f383e83f84c0`).
Next build and the focused query/unit execution passed. The precommit unit
receipt encountered the existing same-head immutability guard; it is not a new
exact-head proof. No receipt was deleted or altered to bypass that guard.

Rendered comparison: the preserved Packet A [mobile baseline](../../artifacts/visual-review/workspace-makeover/after/visits-390.png)
and this correction's [desktop](../../artifacts/visual-review/workspace-makeover/pr114-applied-query/visits-1440.png),
[mobile](../../artifacts/visual-review/workspace-makeover/pr114-applied-query/visits-390.png),
[dark desktop](../../artifacts/visual-review/workspace-makeover/pr114-applied-query/visits-1440-dark.png)
and [dark mobile](../../artifacts/visual-review/workspace-makeover/pr114-applied-query/visits-390-dark.png)
were inspected. First records remain in the viewport at1440/390 without page
overflow. These four-record captures prove this state correction only, not the
busy31-day B–D visual acceptance. The raw legacy outcome label, mobile filter
density, range chart and historical picker still need the full B integration.
Baseline UI kept native form controls and existing primitives; the Ponytail
advisory removed redundant mount resets now covered by the keyed workspace.

Next B slice: reuse one parameterized literal per-field SQL predicate across
events and the exact count/50-record register. Preserve text lead joins and
legacy single-date semantics. Use an independent EXISTS-membership picker with
25 rows plus sentinel and exact selected identity, including inactive former
representatives. Remove the old directory-draining fallback; absent055 preserves
bounded ordinary records but makes joined search explicitly unavailable. SQL
plans and real HTTP assertions must pass before claiming those consumers ready.

### Shared-reader continuation after verified Owner push

PR114 head `ab7d4f60078a37017aaca6480e09c9e2454597fa` was verified remotely.
Run [34350333124](https://github.com/Deep0202006/CRM_Zero/actions/runs/34350333124)
passed preflight and unit-build. The disposable PostgreSQL runtime worked;
existing Field Visits, Pipeline and Imports database proofs passed. B-D SQL
failed its representative-search assertion:61 matching users own62 visits,
including the legacy record. The corrected assertion checks both cardinalities
and that exact legacy identity. HTTP/inner-plan execution was not reached.
The browser job failed an older automatic-filter-request expectation. That
regression now requires no draft request, followed by exactly one Apply request.
Attestation/verify were skipped; this run is not a green delivery certificate.

The shared scalar predicate now drives event reading and the atomic matched
count/50-ID register query. Subsequent detail and identity enrichment remain
bounded live reads, not a cross-request snapshot. Exact count checks reject
server-truncated records and lead labels. Ordinary unsearched records remain
available before055 activation; joined search explicitly requires activation.
Register pages stop at400 with a narrowing instruction. The independent picker
uses current field capability OR retained Visit membership,25 options plus a
sentinel and an independently selected identity. Its one RPC is within its
4-reader budget. Native controls load it on deliberate focus/search, not every
register refresh. Nullable global counters remain unavailable, never zero.
Closing selected evidence aborts pending work and prevents late window opening.

Independent criticism resolved truncated identity enrichment and long-name
cursor failures. SQL and TypeScript now agree on a1000-code-point normalized
cursor prefix, with UUID tie-breaking; full visible names are retained subject
to the64KiB response ceiling. The synthetic long name includes astral Unicode.
Catalog assertions cover fixed caller search paths, stable/invoker flags and
restricted grants. The HTTP harness now extracts the actual register/picker
inner statements too, checks exact RPC agreement, and exercises actual JSON
pagination/public-role denial. Those SQL/HTTP results remain pending CI.
The fixture required registering existing capability-catalog ownership and
linking the existing capability-assignment authority to Auth; no application
capability writer, policy or certificate was changed.

Local build/TypeScript and the registered workspace browser command passed.
The existing same-head common-receipt immutability guard prevented replacing
earlier receipts; canonical command results are preserved and are not claimed
as final-head proof. A fresh committed head is required for delivery evidence.
Actual [desktop](../../artifacts/visual-review/workspace-makeover/pr114-shared-readers/visits-1440.png),
[mobile](../../artifacts/visual-review/workspace-makeover/pr114-shared-readers/visits-390.png),
[dark desktop](../../artifacts/visual-review/workspace-makeover/pr114-shared-readers/visits-1440-dark.png)
and [dark mobile](../../artifacts/visual-review/workspace-makeover/pr114-shared-readers/visits-390-dark.png)
were inspected: first record visible and no horizontal page overflow. These are
four-record continuation captures, not full busy31-day visual acceptance.
Ponytail review retained native controls and the existing request resource;
no new library or generic data layer was introduced.

At committed head `d6c4695a590580fcf573be5c6398d61aa3a6bb6f`, registered
Visits unit, TypeScript, lint, workspace browser and Foundation browser proofs
passed locally with clean-head receipts. The following SQL-only correction
preserves the existing `getISTBusinessDayBounds` fixed+05:30 legacy interval
even for old accepted dates; its new lower/upper-bound assertion remains CI-only.
[PostgreSQL17 fixed-offset interval support](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT)
was the only additional syntax research. Unchanged browser checks are not rerun
for this SQL-only delta. Required exact-head GitHub CI is still pending.

### Section0.3 lifecycle verification and export continuation

Owner-published head `322725030148f1c5fc84c51bf04c0a46fe9803f7` passed
[run34361458554](https://github.com/Deep0202006/CRM_Zero/actions/runs/34361458554).
All six required jobs succeeded. Both `bcd-process-lifecycle-unit` and the complete
`bcd-readers-postgres` command passed; PostgreSQL/E2E execution ran rather than
NOT_REQUIRED accounting. Signal-aware close observation, bounded shutdown and
post-cleanup PASS reporting resolve the former exit13 defect. This is exact-head
CI evidence for that source, not acceptance of unfinished B–D features.

The following export continuation replaces the punctuation sanitizer and50-ID
lookups with the register's `crm_visit_matches_v1` predicate. The export RPC joins
only the existing exported labels, preserves arbitrary legacy TEXT business IDs,
and traverses500 rows by descending created_at/visit_id with microsecond cursors.
Legacy single-date OR-check-in semantics stay separate from canonical ranges.
Exports now require a date or a range of at most31 days; all-time register browsing
remains available. A raw page/Excel-cell bound precedes SQL JSON aggregation.

The entire export shares one24-reader budget plus1 Auth HTTP and2 authorization
DB reads, with no retries or fresh enrichment budgets. The normal5000-row ceiling
needs10 pages,1 EOF and1 ERP request (12 reader/15 total physical attempts).
The maximum is27 physical attempts. Lower effective page limits may exhaust the
budget sooner and fail explicitly. Source JSON is capped at4MiB, each page at1MiB,
ERP at1MiB and the workbook at8MiB. The8-second shared deadline is checked before
and after XLSX generation; synchronous generation cannot be preempted by a timer.
Oversized cells, missing ERP, failed reads and exceeded limits return no workbook.

ERP sheets still use048's all-time latest observed business interpretation, not
049 current overrides or filtered-period totals. A bounded998-entry catalog/raw
name precheck precedes calling the unchanged048 function; an exceeded catalog
limit requires a separately reviewed export-capacity change, not hidden truncation.
Both segment summaries must reconcile before formatting. The new Scope sheet
labels this independent ERP scope without changing the existing data columns.

| Source / definition | Consumer | Registered proof |
|---|---|---|
| Shared literal Visits predicate, legacy/range dates, exact UUIDs | Bounded export RPC → existing XLSX endpoint | `bcd-readers-postgres`: actual SQL and PostgREST-backed production formatter; decoded workbook IDs vs predicate |
|048 latest observed ERP, unchanged counts/percentages | Existing Retailer/Distributor sheets plus explicit Scope sheet | ERP JSON equality, catalog/raw-name limits and reconciled formatter tests |
| One scoped request/deadline budget,5000-row/size ceilings | Export reader and error response | `field-visits-unit`: EOF,5001, short-page cap, cancellation, identity/order/cell checks and post-serialization deadline |

Independent criticism corrected the bare-PostgREST `/rest/v1` test-prefix mismatch
and the fact that047 bounds trimmed ERP names, not raw surrounding whitespace.
The adapter is test-only and preserves scoped fetch accounting. No production
connection resolution, applied migration or Owner ledger changed. Ponytail review
retained the installed XLSX formatter and shared report resource; no library or
generic export framework was added. New SQL/HTTP export behavior remains pending
its own exact-head CI. The existing screenshots are unchanged; full-range page
integration, mobile/outcome finishing and C/D remain required.

| Packet | Status |
|---|---|
| B Visits range, joined register search, historical picker, applied scope | Shared register/picker slice integrated; SQL/HTTP CI, full range-chart/representative analysis and busy visual acceptance pending |
| C typed Team history and filtered Pipeline inspection/context | Pending implementation |
| D self-scoped My Day history and lazy Admin task/target review | Pending implementation |
| Physical PostgREST requests, rendered screenshots, exact final-head CI | Pending; no local SQL PASS claimed |

This document is source-review context, not proof. A draft PR is for early
database verification; it must not be declared manual-merge ready until every
packet and required final-head check is complete. Final Owner activation
instructions will identify the reviewed SQL and safe pre/postchecks. Production
application remains Owner-only.
