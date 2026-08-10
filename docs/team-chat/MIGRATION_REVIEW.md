# Team Chat V1 Migration Review

## CURRENT

Migration `031_team_chat_v1.sql` is an unapplied proposal on the feature branch. Local migrations do not prove the production schema; rollout begins with read-only production introspection.

## INVARIANT

- Additive tables, indexes, functions, triggers, grants, and RLS only.
- Existing users are referenced, never modified.
- Message sender comes from `auth.uid()` and private reads require active membership.
- Admin role alone grants no private-DM access.
- Message bodies are immutable in V1; no authenticated update/delete grant exists.
- Team membership is added for active employees; inactive membership cannot pass the active-user authorization check.
- The Realtime payload contains identifiers only and is a refetch signal.

## Review checklist

- [ ] Owner approves the exact reviewed migration for production application.
- [ ] Read-only introspection confirms `public.users(id, name, is_active)` and UUID identity compatibility.
- [ ] Supabase Realtime Broadcast prerequisites are available in the target project.
- [ ] RLS policies are reviewed for member reads, self-only sends, private topics, and absent admin bypass.
- [ ] Indexes are reviewed for member lookup, DM uniqueness, message pagination, unread lookup, and push ownership.
- [ ] VAPID secrets are configured only in server/hosting secret storage.

## KNOWN DEBT

V1 deliberately omits offline sending, attachments, editing, deletion, reactions, threads, and channel administration.
