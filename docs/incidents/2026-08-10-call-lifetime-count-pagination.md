# Call lifetime count pagination mismatch

## Summary and impact

Employee Call Logs presented the newest loaded page length as the history record count. Employees with more than 100 confirmed calls therefore saw an incomplete number even though their confirmed rows remained in Supabase.

## Proven cause

The owner-scoped history query already requested an exact count and had no recent-date lower bound. Its response returned `total`, but the browser repository discarded that metadata and derived `confirmedCount` from the loaded array. `QueueList` then rendered `items.length`.

IST day bounds affect only today's optional metrics; they do not restrict lifetime history. No call rows were deleted or rewritten.

## Recovery and protection

The repository now preserves the explicit authoritative lifetime total. Call Logs separately presents confirmed lifetime total, pending local calls, and loaded rows. Offline fallback is labeled device-local rather than complete lifetime history. Other queues retain their existing item-length count.

Regression tests cover multi-page totals, pre-August records, pending separation, offline labeling, owner scope, daily metrics, and destructive-path absence. A semantic test is preferred over a regex harness guard for count authority.

Owner: Calls reliability. Status: implemented in draft PR; production verification remains read-only.
