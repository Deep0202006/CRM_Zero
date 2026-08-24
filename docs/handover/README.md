# CRM Supabase Handover Phase 1

Status: readiness only. Production Supabase is read-only and remains rollback authority. This repository does not perform a migration, alter migrations 001-050, create migration 051, or move Vercel.

## Locked boundary

Vercel remains the Next.js web/API application, production domains, Vercel Functions, Vercel Cron (`/api/maintenance/selfie-retention`), `CRON_SECRET`, VAPID/Web Push, and GitHub/Vercel deployment flow. Supabase moves as one compatible backend: PostgreSQL schema/data, Auth, Data API/RPC, RLS/grants/roles, Realtime, Storage metadata/object bytes, pg_cron, extensions, and Supabase Auth/Realtime/Storage configuration. Edge Functions and Vault secrets are inventoried, not assumed.

The target operator does not need Vercel ownership. It returns its URL, public key, and service-role credential through approved secure transfer to the Vercel owner for final cutover.

## Source inventory and Free budget

Run `node scripts/handover/inventory.mjs` only with authorized read-only source access. It writes the sanitized manifest to ignored `.handover/source-inventory.json`; it includes catalog metadata, counts, aggregate amounts, migration boundary, and no row payloads, user identifiers, object names, secrets, JWTs, or connection strings. The query is a `BEGIN READ ONLY` transaction.

Free-plan reference: verifiedAt `2026-08-24`; source: https://supabase.com/docs/guides/platform/billing-on-supabase and https://supabase.com/pricing. Limits: two active Free projects, 500 MB database/project, 1 GB Storage, 5 GB egress, 5 GB cached egress, 50,000 MAU, 200 concurrent Realtime connections, and 2,000,000 Realtime messages/month. Classify database and Storage usage GREEN below 50%, YELLOW 50-70%, RED above 70%. Egress, cached egress, Realtime messages, and connections require `MANUAL_DASHBOARD_EVIDENCE`; database catalog cannot prove their current consumption. A RED database/Storage/bandwidth result blocks optional rehearsal export pending human review. Production and staging already use the two active Free projects: do not create a third or use paid Branching.

## Vercel environment handoff

Read-only Project Environment Variable name audit is required in both Production and Preview for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; never print values. Until parity is established, this state is `VERCEL_ENV_HANDOFF_REQUIRED`: retain the existing legacy values in `vercel.json` and do not deploy a changed backend configuration. `handover:check` allows only the exact pinned legacy URL/anon pair and rejects new committed `*.supabase.co` endpoints, embedded Supabase keys, and any service-role value in `vercel.json`. Once parity is confirmed, remove that legacy exception and keep backend selection only in Vercel Project Environment Variables.

## Artifacts and transfer

Generated artifacts stay in ignored `.handover/`:

```text
.handover/
  source-inventory.json
  roles.sql
  schema.sql
  data.sql
  SHA256SUMS
```

Use the supported `supabase db dump` workflow for `roles.sql`, `schema.sql`, and `data.sql`; restore the live snapshot rather than replaying immutable CRM migrations 001-050. SHA-256 every artifact. Database dumps include Auth and sensitive business data, so `ENCRYPTION_REQUIRED` applies before any bundle leaves Owner custody. Do not make a recipient package until a recipient public key or approved secure transfer exists. No dump is committed.

At the approved rehearsal/final export window only: run `supabase db dump --linked --role-only -f .handover/roles.sql`, `supabase db dump --linked -f .handover/schema.sql`, and `supabase db dump --linked --data-only --use-copy -f .handover/data.sql`, then `node scripts/handover/checksums.mjs`. Do not run those exports repeatedly or outside Owner custody.

Storage is a separate byte transfer: use Supabase S3-compatible API/rclone into the self-hosted Storage service, never direct volume copies. Preserve bucket identity, visibility, paths, metadata, and bytes; certify count, total bytes, sampled content integrity, authenticated upload/download/admin read, and unauthorized-read rejection. `public.field_visit_media` remains a database backup/fallback authority and belongs in the database dump.

## Target and cutover contract

Target requires a pinned supported self-hosted Supabase release, PostgreSQL 17, compatible Auth/Storage/Realtime schemas, required extensions, API gateway, Auth, PostgREST, Realtime, Storage, Supavisor/appropriate DB access, independent backups, and public valid TLS endpoints for `/auth/v1`, `/rest/v1`, `/realtime/v1` (WSS), and `/storage/v1`. A private-only PostgreSQL host is `TARGET_PLATFORM_INCOMPATIBLE`. Validate DNS/TLS/CORS/origins for `zerodatacrm.com`, `www.zerodatacrm.com`, and a controlled Vercel Preview origin.

Auth UUIDs and password hashes survive exactly; verify Auth Admin create/update/delete/reset parity. Session invalidation from new signing material is `EXPECTED_REAUTHENTICATION`, not data loss. Preserve same-origin Dexie/localStorage recovery data; after login with the same UUID, owner-bound outboxes remain recoverable without clearing browser storage.

Inventory exact `supabase_realtime` membership, Postgres Changes subscriptions, private Team Chat Broadcast, `realtime.setAuth`, `realtime.messages` authorization, and target WSS. Keep Vercel Cron remains on Vercel; inventory/migrate only Supabase pg_cron jobs to avoid duplicate selfie retention. `nightly-kpi` referencing missing `public.daily_kpi_snapshots` is `KNOWN_LIVE_DEFECT`, preserved rather than repaired here.

Rehearsal restores to a self-hosted target and changes Vercel Preview only. Final cutover is documented work: dashboard headroom, write drain, final inventory/dumps/Storage transfer, target restore, source vs target manifest comparison, Auth/RPC/RLS/Realtime/Storage verification, then Vercel Production environment switch and redeploy, reauthentication, CRM smoke, release or rollback. Source remains intact; no blind failback after target writes without reconciliation.
