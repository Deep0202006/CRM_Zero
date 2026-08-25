# CRM Supabase handover — lossless certification

This is readiness and rehearsal tooling only: source production stays active, healthy, authoritative, and read-only; the applied/immutable boundary is read from `supabase/migrations/APPLIED_OWNER_MIGRATIONS.json`; no Vercel backend changes occur; and source remains rollback authority. No tool in this PR creates a target, performs cutover, or synthesizes Owner approval.

## Owner gates

`owner-gates.json` is the machine contract. G0 permits sanitized read-only inventory after source identity proof. G1 is required before target infrastructure/configuration mutation. G2 records complete rehearsal parity but grants no production authority. G3 is required before Vercel environment, DNS, production routing, or target-promotion changes. G4 is separate and is the only gate that permits source pause/deletion discussion. Agent/Codex output is never approval evidence.

`owner-access-checklist.json` keeps every access/custody item at `MANUAL_OWNER_EVIDENCE_REQUIRED` until the Owner verifies it. Secret values are never recorded.

## Boundary and source identity

Vercel retains Next.js/API routes, domains, Functions, Vercel Cron (`/api/maintenance/selfie-retention`), `CRON_SECRET`, VAPID/Web Push, and deployment flow. Supabase moves PostgreSQL, Auth, Data API/RPC, RLS/grants/roles, Realtime, Storage, pg_cron, extensions, and Supabase service configuration. Edge Functions and Vault are inventoried as facts, never assumed.

`source-baseline.json` records a volatile Owner-provided read-only observation for project `gwfjkpsoaoherntwhdyf`: PostgreSQL 17.6, 45 public tables, 6 views, 72 functions, 84 policies, 7 Auth users, 1 Storage bucket, 121 Storage objects, 11 Realtime publication tables, 6 extensions, 3 cron jobs, 0 Vault secrets, and 0 Edge Functions. These are not pass conditions. Fresh authenticated read-only inventory replaces them; production is never changed to match the snapshot.

Run inventory only with Owner-supplied `HANDOVER_SOURCE_DB_URL`. Its hostname must be the intended production DB host and the live query must prove PostgreSQL 17; otherwise `HANDOVER_SOURCE_IDENTITY_UNRESOLVED`. The URL is never printed or recorded. No `--linked` fallback exists. Functions/secrets use the same verified project ref only after this check. `vaultSecretCount` is `vault.secrets`; `edgeFunctionSecretCount` is the read-only Edge Function secrets listing.

## Manifest V2 and comparison

Ignored `.handover/source-inventory.json` is V2. It contains privacy-safe application semantic fingerprints: public tables/columns/types/enums, constraints, indexes, views, functions/RPCs, triggers, policies across public/storage/realtime, privileges, app Realtime publication membership, pg_cron name/schedule/command fingerprint, extensions, bucket configuration, and business totals. SQL definitions and policy predicates are hashed; no row values, emails, paths, credentials, or secret names are emitted.

Deep mode (`node scripts/handover/inventory.mjs --deep`) fingerprints every public table from canonical JSON rows, sorted by per-row SHA-256 under UTC session settings. It also fingerprints Auth UUID, identity, and credential/password-hash sets before any target login. Normal inventory uses local 60-second statement and 5-second lock timeouts; deep queries use a bounded 120-second statement timeout. Deep mode checks database bytes and the configured safe limit first, and fails `HANDOVER_DEEP_INVENTORY_BUDGET_EXCEEDED` instead of stressing a RED source. Volatile sessions/refresh state are excluded because post-cutover session invalidation is `EXPECTED_REAUTHENTICATION`.

`node scripts/handover/compare.mjs` classifies app schema/types/policies/grants/publication membership/deep data/Auth/bucket config/full Storage integrity/business invariants as MUST_EQUAL. It separately enforces application `pg_cron` job name/schedule/active/command-hash/classification parity (`HANDOVER_CRON_PARITY_FAILED`), required extension name parity (`TARGET_EXTENSION_MISSING`), and explicit compatibility evidence when versions differ (`TARGET_EXTENSION_COMPATIBILITY_UNRESOLVED`). PG17, service schema compatibility, API/Auth/PostgREST/Realtime/Storage/Supavisor, TLS/CORS/WebSocket, and backups are MUST_BE_COMPATIBLE; a missing capability is `TARGET_PLATFORM_INCOMPATIBLE`. Physical bytes, cron execution history, advisor findings, and Vercel errors are SOURCE_BASELINE_ONLY; service-managed timestamps/job IDs/Realtime partitions are VOLATILE/SYSTEM_MANAGED.

Only application hooks are inventoried for managed schemas: non-internal `auth.users` trigger name/enabled/definition hashes, Storage policies, and Realtime `messages` policies (including `chat_private_broadcast_member_select`). Target trigger parity is exact; managed internal triggers are excluded. `.handover/platform-policies.sql` may be generated only after dump inspection proves a supported dump omits reviewed application-owned policies/grants; it is applied only to rehearsal/target.

Fresh inventory records Edge Function and Vault counts. Zero is valid current evidence, never a permanent assumption. A nonzero Edge Function count blocks with `HANDOVER_EDGE_FUNCTION_EVIDENCE_REQUIRED` until slug/code/config/JWT behavior has certified transfer evidence; a nonzero Vault count blocks with `HANDOVER_VAULT_EVIDENCE_REQUIRED`. Secret names and values are never recorded.

## Artifacts, dumps, and Storage

All plaintext artifacts stay ignored under Owner-controlled encrypted `.handover/`: source/target inventories, roles/schema/data dumps, `platform-policies.sql`, Storage transfer metadata, comparison report, dump coverage report, and `SHA256SUMS`. `node scripts/handover/checksums.mjs` creates checksums for every generated artifact; `--verify` fails on any drift. Send the final encrypted-package SHA-256 through a separate trusted/signed channel. Tracked-file checks reject likely dump/export/secret bundles outside this location; canonical `supabase/schema.sql` is exempt.

At rehearsal/final export only, use the supported CLI `--db-url` workflow with the secure Owner variable: role dump, schema dump, and data dump. Do not replay the live snapshot through historical migrations. `node scripts/handover/dump-inspect.mjs` reads generated `data.sql` structurally and fails with `HANDOVER_AUTH_DUMP_INCOMPLETE` or `HANDOVER_STORAGE_METADATA_INCOMPLETE` if Auth users/identities or Storage buckets/objects are absent. Until a rehearsal dump exists: `NOT_RUN_UNTIL_REHEARSAL`.

Storage is a separate transfer through supported S3/Storage API: Source Supabase → Owner-controlled encrypted package → recipient → target Storage. Never copy volumes or give the recipient source credentials. Certification is FULL object integrity: exact bucket config/count/bytes, aggregate manifest, and EVERY content hash/check-download—not sampling—plus authenticated upload/own read/admin read and unauthorized rejection. User-derived object paths and per-object hashes exist only inside the encrypted package. `public.field_visit_media` stays DB state; report relationBytes and payloadBytes separately.

Storage transfer is two-phase: `BULK_STORAGE_COPY`, then `FINAL_STORAGE_DELTA` under final quiesce. Full certification requires both phases, exact bucket configuration/count/bytes, every object content, aggregate fingerprint, and zero mismatches. Direct volume copy is forbidden.

## Snapshot and cutover consistency

`consistency-contract.json` governs `LIVE_BULK_COPY`, `SNAPSHOT_BOUND`, `WRITE_QUIESCED_FINAL`, and `DELTA_RECONCILED`. Rehearsal bulk copy may run while source remains active, but G2 cannot pass unless the source manifest, dump/package hash, and target restore bind to the same source snapshot; otherwise `SOURCE_SNAPSHOT_UNBOUND`.

Final G3 needs a short Owner-approved final quiesce/delta across browser writes, durable queues, Vercel APIs/Cron, `pg_cron`, Auth, and Storage. The browser Supabase URL is build-time configuration, so G3 remains blocked at `CLIENT_CUTOVER_COMPATIBILITY_NOT_RUN` until a dedicated product proof demonstrates required reload, IndexedDB survival, exactly-once Mapping/Calls/Field Visit/Attendance/Pipeline convergence, no queue clearing, and late-source-write reconciliation. PR82 implements no runtime cutover behavior.

## Target, configuration, and rollback

Target requires an exact pinned self-hosted release, image tags/digests, PostgreSQL `SHOW server_version` proving 17, API gateway, Auth, PostgREST/Data API/RPC, RLS/grants/roles, Realtime, Storage/S3, Supavisor/pooling, `pg_cron`, required extensions, TLS, independent backups/restore, service versions, and rehearsal-proven Auth/Storage/Realtime schema compatibility. Gateway may be Envoy or supported Kong; observable CRM behavior is authority. Preserve current anon/service-role API-key semantics initially; opaque-key migration is separate.

`rehearsal-target.json` is provider-agnostic and creates nothing. It requires an Owner-controlled Linux server, server-side Docker Compose, pinned release and image digests, PostgreSQL 17, current default Envoy unless supported Kong compatibility is proven, TLS, stable endpoint, restricted firewall/no public PostgreSQL, durable DB/S3 storage, independent encrypted backups, monitoring, and a restore drill. Provider/account/region remain G1 Owner decisions; sizing follows current official recommended self-host resources rather than development minimums.

Current official Supabase guidance, verified 2026-08-25, treats self-hosting as a multi-service deployment whose configuration, monitoring, backups, and disaster recovery are the operator's responsibility; managed backups/PITR are unavailable. Envoy is the current default gateway, with Kong a supported override. The CLI dump excludes managed schemas by default, so dump structure must be inspected rather than assumed. Auth data continuity does not configure JWT/API keys, OAuth providers, redirects, SMTP, or other Auth settings; expected reauthentication is explicit. Storage database metadata does not transfer object bytes; the supported S3 endpoint enables tools such as rclone for object transfer. Realtime additionally requires publication/logical-replication, security/JWT, private Broadcast/Postgres Changes, and WebSocket/TLS proxy evidence. Supabase-managed internals are configured through supported self-host mechanisms, not blindly cloned.

Official references: https://supabase.com/docs/guides/self-hosting, https://supabase.com/docs/guides/self-hosting/docker, https://supabase.com/docs/guides/self-hosting/self-hosted-envoy, https://supabase.com/docs/guides/self-hosting/restore-from-platform, https://supabase.com/docs/reference/cli/supabase-db-dump, https://supabase.com/docs/guides/self-hosting/auth/config, https://supabase.com/docs/guides/self-hosting/realtime/config, https://supabase.com/docs/guides/self-hosting/storage/config, and https://supabase.com/docs/guides/self-hosting/self-hosted-s3.

Use `configuration-matrix.json` to record sanitized configuration evidence for `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, Auth site/redirect/password/JWT/SMTP settings, PGRST schemas/max rows, Realtime/private Broadcast/Postgres Changes/DB encryption key, Storage public/S3 settings, backups, and TLS/DNS/CORS/WebSocket proxy behavior. Unknown source settings are `MANUAL_DASHBOARD_EVIDENCE`, never guessed.

Free reference verifiedAt `2026-08-24`: two projects, 500 MB DB, 1 GB Storage, 5 GB egress/cached egress, 50k MAU, 200 Realtime connections, 2m messages. GREEN <50%, YELLOW 50-70%, RED >70%; egress and Realtime consumption require `MANUAL_DASHBOARD_EVIDENCE`. A RED result blocks optional rehearsal export. Source pausing policy is external; record its URL and verifiedAt at cutover, not a permanent restore window. Independent encrypted backup is mandatory. After target receives writes, reconcile them before any rollback; never blindly switch Vercel back.

`VERCEL_ENV_HANDOFF_REQUIRED` remains until authorized Production and Preview environment-name parity for the three Supabase variables is proven without printing values. It blocks actual cutover, not readiness tooling. Production Vercel retains its current backend during this PR.

## Source advisor baseline

`source-advisor-baseline.json` sanitizes the current read-only finding classes as `SOURCE_BASELINE`: Security Definer views, mutable function `search_path`, SECURITY DEFINER RPC exposure, leaked-password-protection, and RLS/no-policy informational findings. They are neither migration defects nor permission to repair production. Target parity preserves intended behavior or fails on incompatibility; security hardening is a separate Owner-approved R3 task.

Before G3 the managed source remains authoritative, so no routing rollback is needed. Because a Free project can pause after inactivity, G3 requires the Owner's `SOURCE_ROLLBACK_AVAILABILITY_PLAN`: safe default `KEEP_MANAGED_SOURCE_ACTIVE`, or explicit `OWNER_ACCEPTS_PAUSE_RESTORE_RTO`. Any cost needed to guarantee active rollback requires separate Owner approval; PR82 creates no cost. After target accepts any production write, `ROLLBACK_WRITE_RECONCILIATION_REQUIRED` blocks blind switch-back until writes are reconciled. G3 never permits pausing or deleting the managed source; only G4 can authorize that separate decision.

## Credential execution discipline

Credentialed dump/deep workflows never run in GitHub Actions or a shared runner. They run only after G1 on the Owner-controlled Linux rehearsal host, using environment/PGPASS-style delivery where supported. A CLI operation that necessarily exposes a database URL in process arguments is isolated to that host and never copied into shell-history documentation. Credentials, URLs, raw Auth/customer rows, object paths, and unencrypted artifacts are never logged, committed, uploaded as CI artifacts, or written into `.handover/` metadata.
