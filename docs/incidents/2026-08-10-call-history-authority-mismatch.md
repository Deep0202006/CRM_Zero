# Call History Authority Mismatch — 2026-08-10

## Summary and employee impact

Employees reported that calls made today were absent from their own Call Logs history while Admin Team KPI showed the work. This was a read-consistency incident: confirmed work could be present in Supabase yet suppressed from the employee history response. No repair or production mutation was performed.

## Detection and timeline

- 2026-08-08: commit `1949d748` introduced the server history endpoint with history and derived metric queries in one failure boundary.
- 2026-08-10: PR #15 hardened durable call submission, free-text identity recovery, and exact-item priority confirmation; it did not change the history endpoint.
- 2026-08-10: employee/KPI disagreement was reported and investigated.

## Exact affected implementation

`src/app/api/call-logs/history/route.ts` awaited the paginated `call_logs` history query together with today's calls, all assigned `tasks`, and `task_status_history`. Any one error returned `502 CALL_HISTORY_FAILED`. `fetchCallLogSnapshot` then caught that response and silently returned only the browser-local snapshot. The page also waited for the general sync backlog and committed history state only after optional local lead/task enrichment.

## Proven root cause and contributing conditions

The critical history read and optional daily metric enrichment shared an all-or-nothing failure boundary. Source history and blame prove this mechanism. Because the browser fallback was silent and device-local, a confirmed row absent from that browser's IndexedDB looked missing even though Admin KPI independently read server authority.

Contributors:

- optional task/history schema or transient query failures owned history availability;
- the API exposed one undifferentiated error code;
- the repository's safe fallback had no visible degraded-state signal;
- sync backlog or local enrichment delay/failure could prevent the page from committing an already retrieved snapshot;
- write durability was protected by PR #15 while employee read authority lacked an equivalent regression test.

The exact historical auxiliary error for each affected session cannot be reconstructed because the route did not record sanitized source-level failure telemetry. Current aggregate-only reads show all selected schemas responding, so the transient trigger was not reproduced during the audit.

## Data integrity findings and safety assessment

A read-only production audit for the current IST day observed 36 distinct call IDs across three anonymized user buckets, zero duplicate IDs, and 2,706 retained call rows. The selected history, task, and task-history shapes currently respond successfully. These aggregates support preserved server records but do not prove completeness for every employee browser or every reported call.

- Production inserts/updates/deletes: none.
- Browser/local deletion or clearing: none.
- Historical normalization or repair: none.
- Evidence of deletion caused by this incident: none found.
- Universal proof of no data loss: unavailable; browser-local stranded rows cannot be read remotely.

## Why KPI could show calls while Call Logs did not

Admin KPI uses its separate server-authoritative reporting path. Employee Call Logs used `/api/call-logs/history`; an auxiliary metric error could fail that entire endpoint, after which the client displayed only its incomplete local cache. Thus the same confirmed server ID could count in KPI and remain temporarily invisible on a particular employee device.

## Recovery behavior

The API now establishes authenticated ownership and retrieves authoritative history first. Only that query can produce `CALL_HISTORY_FAILED`. Auxiliary metric queries run afterward; failures return the call rows with `metrics_authoritative: false`. The browser merges confirmed rows with durable pending outbox rows by stable `log_id`, gives server rows display precedence, preserves all local/outbox data, commits the history before local enrichment, drains the general queue without blocking the read, and surfaces offline/history/metric degradation explicitly.

## Regression protection and tests

`callHistoryAuthority.test.ts` covers auxiliary failure with successful history, critical history failure, server-only confirmed rows, pending/confirmed union, duplicate-ID precedence, auth/capability boundaries, IST/order behavior, visible degradation, and destructive-pattern absence. Existing Calls reliability, follow-up, KPI, and synthetic-audit tests remain required.

## Harness protection decision

The Calls contract and semantic regression tests were updated. A regex guard was deliberately declined: it cannot accurately distinguish optional enrichment concurrency from independent failure boundaries without false positives. The existing destructive-action guard remains applicable.

## Follow-up owner and status

Owner: Calls reliability. Status: code repair complete; authenticated production runtime reconciliation remains pending safe employee validation after review/deployment.
