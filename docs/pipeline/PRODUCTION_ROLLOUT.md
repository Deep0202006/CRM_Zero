# Pipeline Production Rollout

No production action is authorized by this document.

1. Complete `MIGRATION_REVIEW.md` catalog checks and obtain exact owner approval.
2. Apply migration 032 in a controlled window; never create or move a test lead.
3. Deploy the application and verify authorized segment reads using existing records.
4. Confirm a natural assigned-user transition reuses one operation ID; a non-owner remains view-only.
5. Confirm another authorized browser converges after focus/refresh and no call row is generated.
6. Monitor typed errors without business content.

Rollback the app while preserving outboxes, then follow migration notes. Never clear queues or rewrite history.
