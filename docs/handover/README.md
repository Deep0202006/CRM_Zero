# CRM Supabase handover — lossless certification

This is readiness tooling only: source production is read-only, migrations 001-050 are immutable, no Vercel backend changes occur, and source remains rollback authority.

## Boundary and source identity

Vercel retains Next.js/API routes, domains, Functions, Vercel Cron (`/api/maintenance/selfie-retention`), `CRON_SECRET`, VAPID/Web Push, and deployment flow. Supabase moves PostgreSQL, Auth, Data API/RPC, RLS/grants/roles, Realtime, Storage, pg_cron, extensions, and Supabase service configuration. Edge Functions and Vault are inventoried as facts, never assumed.

Run inventory only with Owner-supplied `HANDOVER_SOURCE_DB_URL`. Its hostname must be the intended production DB host and the live query must prove PostgreSQL 17; otherwise `HANDOVER_SOURCE_IDENTITY_UNRESOLVED`. The URL is never printed or recorded. No `--linked` fallback exists. Functions/secrets use the same verified project ref only after this check. `vaultSecretCount` is `vault.secrets`; `edgeFunctionSecretCount` is the read-only Edge Function secrets listing.

## Manifest V2 and comparison

Ignored `.handover/source-inventory.json` is V2. It contains privacy-safe application semantic fingerprints: public tables/columns/types/enums, constraints, indexes, views, functions/RPCs, triggers, policies across public/storage/realtime, privileges, app Realtime publication membership, pg_cron name/schedule/command fingerprint, extensions, bucket configuration, and business totals. SQL definitions and policy predicates are hashed; no row values, emails, paths, credentials, or secret names are emitted.

Deep mode (`node scripts/handover/inventory.mjs --deep`) fingerprints every public table from canonical JSON rows, sorted by per-row SHA-256 under UTC session settings. It also fingerprints Auth UUID, identity, and credential/password-hash sets before any target login. Volatile sessions/refresh state are excluded because post-cutover session invalidation is `EXPECTED_REAUTHENTICATION`.

`node scripts/handover/compare.mjs` classifies app schema/types/policies/grants/publication membership/deep data/Auth/bucket config/full Storage integrity/business invariants as MUST_EQUAL. PG17, service schema compatibility, API/Auth/PostgREST/Realtime/Storage/Supavisor, TLS/CORS/WebSocket, and backups are MUST_BE_COMPATIBLE. Physical bytes, cron execution history, advisor findings, and Vercel errors are SOURCE_BASELINE_ONLY; service-managed timestamps/job IDs/Realtime partitions are VOLATILE/SYSTEM_MANAGED. A mismatch is `HANDOVER_PARITY_FAILED`; a missing capability is `TARGET_PLATFORM_INCOMPATIBLE`.

Only application hooks are inventoried for managed schemas: `auth.users` application triggers, Storage policies, and Realtime `messages` policies (including `chat_private_broadcast_member_select`). Do not clone managed internals. `.handover/platform-policies.sql` may be generated only after dump inspection proves a supported dump omits reviewed application-owned policies/grants; it is applied only to rehearsal/target.

## Artifacts, dumps, and Storage

All plaintext artifacts stay ignored under Owner-controlled encrypted `.handover/`: source/target inventories, roles/schema/data dumps, `platform-policies.sql`, Storage transfer metadata, comparison report, dump coverage report, and `SHA256SUMS`. `node scripts/handover/checksums.mjs` creates checksums for every generated artifact; `--verify` fails on any drift. Send the final encrypted-package SHA-256 through a separate trusted/signed channel. Tracked-file checks reject likely dump/export/secret bundles outside this location; canonical `supabase/schema.sql` is exempt.

At rehearsal/final export only, use the supported CLI `--db-url` workflow with the secure Owner variable: role dump, schema dump, and data dump. Do not replay migrations 001-050. `node scripts/handover/dump-inspect.mjs` reads generated `data.sql` structurally and fails with `HANDOVER_AUTH_DUMP_INCOMPLETE` or `HANDOVER_STORAGE_METADATA_INCOMPLETE` if Auth users/identities or Storage buckets/objects are absent. Until a rehearsal dump exists: `NOT_RUN_UNTIL_REHEARSAL`.

Storage is a separate transfer through supported S3/Storage API: Source Supabase → Owner-controlled encrypted package → recipient → target Storage. Never copy volumes or give the recipient source credentials. Certification is FULL object integrity: exact bucket config/count/bytes, aggregate manifest, and EVERY content hash/check-download—not sampling—plus authenticated upload/own read/admin read and unauthorized rejection. User-derived object paths and per-object hashes exist only inside the encrypted package. `public.field_visit_media` stays DB state; report relationBytes and payloadBytes separately.

## Target, configuration, and rollback

Target requires an exact pinned self-hosted release, image tags/digests, PostgreSQL `SHOW server_version` proving 17, service versions, and rehearsal-proven Auth/Storage/Realtime schema compatibility. Gateway may be Envoy or supported Kong; observable CRM behavior is authority. Preserve current anon/service-role API-key semantics initially; opaque-key migration is separate.

Use `configuration-matrix.json` to record sanitized configuration evidence for `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, Auth site/redirect/password/JWT/SMTP settings, PGRST schemas/max rows, Realtime/private Broadcast/Postgres Changes/DB encryption key, Storage public/S3 settings, backups, and TLS/DNS/CORS/WebSocket proxy behavior. Unknown source settings are `MANUAL_DASHBOARD_EVIDENCE`, never guessed.

Free reference verifiedAt `2026-08-24`: two projects, 500 MB DB, 1 GB Storage, 5 GB egress/cached egress, 50k MAU, 200 Realtime connections, 2m messages. GREEN <50%, YELLOW 50-70%, RED >70%; egress and Realtime consumption require `MANUAL_DASHBOARD_EVIDENCE`. A RED result blocks optional rehearsal export. Source pausing policy is external; record its URL and verifiedAt at cutover, not a permanent restore window. Independent encrypted backup is mandatory. After target receives writes, reconcile them before any rollback; never blindly switch Vercel back.

`VERCEL_ENV_HANDOFF_REQUIRED` remains until authorized Production and Preview environment-name parity for the three Supabase variables is proven without printing values. It blocks actual cutover, not readiness tooling. Production Vercel retains its current backend during this PR.
