# Backup and restore runbook

Before migration 030, verify the provider-managed backup status and take a manual backup. For Supabase projects with logical backup access, use an encrypted destination and credentials supplied only through the operator environment. Never place connection strings in this repository or command logs.

Required database objects include `users`, `user_capabilities`, `call_logs`, `client_queries`, `mapping_requests`, `mappings`, `tasks`, `task_status_history`, `allocated_targets`, `attendance`, `field_visits`, `command_receipts`, and `team_activity_events`. Required Storage includes the private `visits-evidence` bucket and its object metadata.

Retention:

- daily provider backups: at least 14 days;
- pre-migration logical backup: 90 days;
- monthly restore rehearsal evidence: 12 months.

Restore test:

1. Restore into an isolated non-production project.
2. Run `scripts/backup/verify-backup-schema.sql`.
3. Run `scripts/backup/verify-restored-data.sql`.
4. Compare source counts, projection counts, visits, receipts, and active users with the backup manifest.
5. Verify every visit evidence path has the deterministic `<user>/<date>/<visit>.jpg` form.
6. Sample private objects using an authenticated admin signed URL; confirm anonymous access is denied.
7. Record counts only. Destroy the isolated restore after approval.

No automated backup workflow is enabled because repository backup credentials are not configured. Any future workflow must be manual, encrypted, secret-backed, and approved by an operator.
# Backup location policy

Permanent backups are remote. Employee PCs must never hold full database backups: they retain only the recent operational cache and unsynced work required for offline durability.

- Provider-managed backup is primary.
- An encrypted remote logical backup is secondary.
- Backup and dump files must never be committed to Git or stored in repository folders.
- Unencrypted backups must never be placed in Desktop or Downloads.
- Selfies or other visit evidence must never be copied into GitHub Actions artifacts.
- The browser must not expose a database-export backup feature.
- Restore rehearsal is monthly and uses an isolated authorized environment.
- Restore verification compares safe counts, stable IDs, command receipts, and references; it does not expose record content.
