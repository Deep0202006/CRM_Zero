# Retired Employee Identity Erasure Contract

## Default rule

Class A business history is permanent. It is never automatically purged, and ordinary product features, Admin capability, APIs, background jobs, migrations, CI, and Codex cannot delete protected history.

## Narrow exception

A separately reviewed operation may erase a named retired employee only when the production Owner authorizes that exact operation. The operation is manual and one-time; it is not a reusable offboarding workflow.

Before execution, the Owner must approve a dry-run receipt that:

- freezes every target as an exact `public.users.user_id` UUID plus the expected Auth identity state;
- proves each UUID resolves to exactly the intended named retired identity and never to the executing Owner;
- enumerates every current direct, transitive, foreign-key, semantic, Storage, Realtime, Auth, and offline-directory dependency;
- classifies each dependency as independent authority, target-exclusive data, identity/access state, or an unexpected blocker;
- records exact row identities and counts without treating historical planning counts as current truth;
- aborts on an unknown table/column, unexpected restricted reference, identity ambiguity, Auth drift, or concurrent dependency change.

Production execution is Owner-only pure PostgreSQL plus a separately reviewed Auth-owner step when Auth identities exist. Codex and CI may prepare and test inert artifacts, but cannot receive production credentials or execute the mutation.

## Disposition rules

Independent business authorities survive. Clear only nullable retired attribution, without changing their business facts:

- Leads and Client Queries remain; clear the retired assignee and do not fabricate a reassignee.
- A Task assigned to an active non-target employee remains; clear a retired nullable creator/assigner.
- Distributor, ERP, Receivables, payments, Field Visits, Mapping, and other customer/company authorities remain unless a future reviewed contract explicitly proves otherwise.
- Chat messages and conversations are independent history. An authored-message or creator dependency is an abort condition until explicitly classified.

After dependency closure, target-exclusive employee data may be deleted only by exact frozen identifiers. This can include target Attendance, target-authored Calls, Tasks assigned to the target, target-only team-work rows, chat membership/read/subscription rows, capability assignments, and finally the target profile. Cascades are allowed only when the dry run lists the exact dependent rows and proves they are target-exclusive.

Deletion of a target-owned row must never delete its referenced Lead, customer, company, payment, or another employee's work. Nullable de-attribution never rewrites resolution, stage, outcome, amount, attendance, or audit facts.

## Required operation artifacts

The reviewed operation must provide four distinct artifacts:

1. Read-only dependency inventory and dry run.
2. Exact execute script with transaction locks, frozen UUID validation, count guards, and fail-closed assertions.
3. Read-only postcheck proving zero target residue, foreign-key integrity, preserved independent rows, and absence from authoritative selectors/KPI.
4. Runbook describing authorization, sequencing, expected Auth state, rollback boundaries, and irreversible steps.

The execute artifact cannot derive targets from a partial name, email fragment, mutable display label, list position, or client-supplied request. No `DELETE USER` application route, UI button, server action, RPC exposed to application roles, cron, or generic stored procedure may implement this contract.

## Concurrency, rollback, and completion

Dry run and execution are separate Owner decisions. Execution must re-run all identity and dependency assertions inside its transaction and roll back on any drift. Database changes remain rollback-capable only until commit. Auth deletion and already-deleted identity data are irreversible and therefore occur only after database postconditions pass and the Owner explicitly continues.

Completion requires exact postcheck evidence. A partial run, changed dependency, unavailable Auth authority, or failed postcheck is not success and cannot be hidden by cleanup or retry.
