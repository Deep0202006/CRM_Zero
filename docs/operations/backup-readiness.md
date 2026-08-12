# Owner Backup Readiness Runbook

1. Create an encrypted, access-controlled PostgreSQL logical backup with `pg_dump` from an owner-managed machine. Include `public`, required Auth/schema definitions, functions, triggers, RLS policies, and migration history; never place connection strings or dumps in Git.
2. Inventory private Storage buckets and copy every object through an authenticated Storage/S3-compatible API into encrypted owner storage. Record bucket, exact key, size, checksum, and copy time.
3. Fingerprint the package: SHA-256 each database dump and Storage manifest, then sign/date a small manifest containing project ref, tool versions, schema list, object count, and total bytes.
4. Restore into an isolated disposable project—not production. Verify schema/RLS/functions, Auth identity linkage, representative row counts, sampled permanent business records, object counts/checksums, and signed evidence access.
5. Record the restore result and securely expire old backup material under the owner's retention policy. Never test restore by mutating live production.
