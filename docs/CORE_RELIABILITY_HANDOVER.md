# ZeroData Core Reliability Handover

## Call write

Browser durable local call and outbox → authenticated `POST /api/call-logs/confirm` → authoritative Supabase `call_logs` row → Admin Team KPI authoritative refetch after Realtime notification.

Every business action keeps one stable `log_id`. The outbox item is removed only after the server returns `CALL_CONFIRMED` or `CALL_ALREADY_CONFIRMED` for that exact ID and authenticated owner.

## Visit write

Browser durable local visit and evidence safety copy → authenticated `POST /api/field-visits/confirm` → authoritative core `field_visits` row → optional evidence and attendance linking → Admin Visit Overview authoritative refetch after Realtime notification.

The core visit is confirmed before evidence work. Evidence or attendance delays never remove or hide the confirmed business visit.

## Offline recovery

Offline work remains in IndexedDB with its original stable ID. Login/bootstrap, application visibility, online events, My Day, Call Logs, My Visits, and explicit recovery actions trigger bounded retry drains. Retries confirm the same ID and never fabricate a replacement record.

## User-facing counts

Calls today is the set of unique genuine `log_id` values recorded for the employee during the current Asia/Kolkata day. Follow-up calls today is the canonical completed self-scheduled follow-up subset and is already included in Calls today. Pipeline audit rows are excluded.

Employee visit totals are the union of server-confirmed visit IDs and current-user local-only visit IDs. Admin totals contain server-confirmed rows only.

## Realtime fallback

Admin pages subscribe to the existing Supabase Realtime publication and debounce authoritative API refetches. If a channel is not subscribed, the visible admin page refreshes every ten seconds; the fallback stops while the page is hidden and on unmount.
