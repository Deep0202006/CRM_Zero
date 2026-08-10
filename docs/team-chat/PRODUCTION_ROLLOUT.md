# Team Chat V1 Production Rollout

## Before approval

1. Review the feature PR, migration, RLS, tests, and preview using mocks only.
2. Perform read-only production introspection for required user columns and Realtime support.
3. Configure VAPID keys and subject in server-side hosting settings; never expose the private key.
4. Obtain explicit owner approval for the exact migration.

## Authorized rollout

1. Record the approved migration checksum and a read-only pre-migration schema snapshot.
2. Apply `031_team_chat_v1.sql` once through the approved Supabase migration workflow.
3. Verify the resulting schema and policies with read-only catalog queries.
4. Deploy the reviewed application build.
5. Have designated employees opt in manually and validate delivery; do not automate messages to real employees.
6. Reconcile IDs, membership, unread state, and routing with read-only queries and application reads.

## Rollback

Roll back application exposure while preserving chat rows. Any schema or data removal requires a separate owner-approved retention plan; this rollout includes no destructive rollback.
