# Team Chat Contract

## CURRENT

Team Chat V1 is an additive, server-authorized domain. Supabase rows are authoritative. One fixed Team conversation contains active employees; one DM conversation is atomically reused for each sorted pair of active employee IDs. History APIs return at most 50 messages per page, newest first.

Private Supabase Broadcast topics (`chat:<conversation_id>`) carry message-created signals only. Clients refetch authoritative bounded history after a signal, reconnect, or focus event and deduplicate by stable `message_id`.

Web Push is opt-in per browser. Subscription endpoints and VAPID private material are server-only. Notifications use privacy-preserving text and link to the intended conversation. V1 disables Send while offline; it does not claim an unsent message was delivered.

## INVARIANT

- Conversation and message IDs are stable; message bodies and sender identities are immutable in V1.
- Every read, send, read-state update, and Realtime topic join requires active membership.
- The authenticated identity owns `sender_id`; clients cannot forge it.
- Admin capability does not bypass DM membership.
- Team membership is granted to active CRM users; inactive users cannot access chat even if a historical membership row remains.
- No message edit/delete API, UI, grant, or RLS policy exists.
- Unread state advances only through a message belonging to the same conversation.
- Pagination is bounded and ordered by `(created_at, message_id)`.
- Realtime and push are delivery signals, never the database authority.
- Sender receives neither their own push nor a second foreground notification.
- Tests and previews never create production messages, subscriptions, or users.

## KNOWN DEBT

Offline sending, attachments, channels, message retention/deletion, presence, and notification preference granularity are intentionally deferred. Production table/function/Realtime settings must be verified read-only before the reviewed migration is applied with owner approval.
