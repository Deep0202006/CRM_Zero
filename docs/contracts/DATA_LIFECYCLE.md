# Data Lifecycle Contract

## CURRENT

Class A permanent business data includes attendance and visit rows, identity, timestamps, business/person/address/GPS/outcome/notes/follow-up/sync metadata, Receivables/payment history, Calls, Leads, and Tasks. It is never automatically purged, and ordinary product or Admin features cannot delete it.

The only exception is the separately reviewed retired-employee identity-erasure policy in [IDENTITY_ERASURE.md](IDENTITY_ERASURE.md). It permits a manual, one-time, production-Owner operation against a frozen exact-UUID manifest after a complete dry run and dependency closure. The operation may delete only target-exclusive employee data. Independent customer, company, financial, Lead, Query, and other employees' authorities survive with nullable retired attribution cleared. This exception does not authorize a reusable application/API deletion feature and does not weaken the default permanence of any other Class A record.

Class B temporary evidence includes attendance and visit selfies. New evidence is stored under an exact authoritative key in the private `visits-evidence` bucket; retention starts at successful server upload and eligibility begins at the exact UTC boundary `uploaded_at <= now - 5 days`. A bounded daily server job claims evidence, deletes only that exact key through the Storage API, and marks it purged only after deletion succeeds or the exact object is already absent. Failed deletion stays retryable and stale claims reconcile safely.

The owner-authorized initial cleanup is a separate operation frozen at `2026-08-11 23:59:59 Asia/Kolkata` (`2026-08-11T18:29:59Z`). Its dry run and execution select authoritative rows by exact identity and report aggregates only. For legacy embedded Attendance evidence, the authoritative attendance timestamp is the documented eligibility fallback because no upload timestamp exists; execution may clear only the data-URL payload and add captured/purged lifecycle metadata. It never migrates that historical payload into Storage and never changes the Attendance business row fields.

## INVARIANT

Media expiry cannot delete or rewrite its business row or change attendance Present/Absent state. List screens do not automatically download evidence. `AVAILABLE`, `PURGED`, and `PENDING` are explicit states; `PURGED` never generates a signed URL or Storage retry. Cleanup is exact-key, bounded, idempotent, failure-recoverable, and cannot target unrelated buckets.

Identity erasure fails closed on an unknown dependency, target mismatch, Auth drift, or non-nullable independent authority. A reviewed dry-run receipt and exact postcheck are mandatory; Codex, CI, previews, migrations, cron, and application runtime never execute the production mutation.

## KNOWN DEBT

No lifecycle debt remains for new evidence. The finite legacy Attendance payload set remains backward-compatible until the separately authorized initial cleanup runs after migration and deployment verification.
