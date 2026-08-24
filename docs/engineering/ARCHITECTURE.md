# CRM architecture map

This current-source discovery map does not replace contracts or runtime
evidence. Resolve focused context before changing a boundary.

## Runtime and boundaries

- **Web:** Next.js 16 and React 19. UI and route handlers are in `src/app`;
  shared domain logic is in `src/lib`.
- **Browser durability:** `src/lib/db.ts` uses Dexie/IndexedDB for offline
  intent and recovery. Confirmed server rows remain cross-device authority.
- **Data API:** Supabase JS uses `.from()` and `.rpc()` against PostgREST; plain
  PostgreSQL alone is not current application API compatibility.
- **Auth:** `src/context/AuthContext.tsx` joins Supabase Auth to app profiles;
  privileged routes enforce identity, roles, and partner scope server-side.
  Auth Admin create/update/delete/reset operations are platform dependencies,
  not merely login/session JWT validation.
- **Database:** Supabase PostgreSQL owns confirmed records, RPCs, RLS, and
  `supabase/migrations`. Applied migration history is immutable.
- **Storage/media:** attendance and Field Visit evidence use Supabase Storage;
  object payload transfer is separate from PostgreSQL schema/data, and media
  lifecycle cannot undo a confirmed business row.
- **Deployment:** GitHub CI and Vercel build/deploy Next.js. Runtime environment
  values provide public Supabase settings; service credentials stay server-only.

## Domains and authorities

| Domain | Main roots | Canonical authority |
| --- | --- | --- |
| Auth | `src/context`, `src/app/login`, `src/app/api/admin` | `employee_identity` |
| Distributor Status / renewals | `src/lib/distributors`, `src/app/api/distributors` | `distributor_account` |
| Receivables | `src/lib/receivables`, `src/app/api/receivables` | `receivable`, `payment` |
| ERP / partner scope | `src/lib/erp`, `src/app/api/erp-*` | `erp_system`, assignment, scope |
| Field Visits | `src/lib/fieldVisits`, `src/app/api/field-visits` | `field_visit` |
| Attendance / calls | `src/lib/attendance`, `src/lib/callLogs` | `attendance`, `call_history` |
| Pipeline | `src/lib/pipeline`, `src/app/api/pipeline` | `pipeline_lead`, `pipeline_stage` |
| Imports / task allocation | `src/lib/distributorMaster`, `src/app/api/task-upload` | delegated import, `task_allocation` |
| Read models | `src/lib/teamKpi`, `src/app/api/my-day` | derived projections |

## Critical flows

- Attendance, calls, and Field Visits can persist local intent, then confirm
  through approved server routes with stable IDs.
- Distributor, receivable, ERP, Pipeline, and task-allocation commands use
  their mapped server/RPC boundary.
- Admin reports and exports read confirmed server data. Follow-ups and My Day
  are derived read models, never writable business authority.
- ERP identity is `public.erp_systems`; Distributor assignment remains
  `public.distributor_accounts.erp_id`.
- Money truth is `public.receivables` plus effective confirmed
  `public.receivable_payments`.

See [DOMAIN_MAP.json](DOMAIN_MAP.json), [AUTHORITIES.json](AUTHORITIES.json),
[CAPABILITIES.json](CAPABILITIES.json), and exact contracts for detailed rules.

## Platform migration touchpoints

- **Data API:** PostgREST/Supabase JS `.from()` and `.rpc()` compatibility.
- **Realtime:** Postgres Changes, private Team Chat Broadcast, and migration 031
  `realtime.send`/`realtime.messages` authorization.
- **Database:** PostgreSQL tables, RPCs, RLS, immutable migrations, and pg_cron
  / scheduled database jobs. Capture the exact live extension inventory during
  platform handover.
- **Auth:** Supabase Auth profiles, token validation, role/partner scope, and
  Admin create/update/delete/reset APIs.
- **Storage:** evidence buckets/lifecycle; object transfer is separate from
  PostgreSQL schema and data.
- **Environment/runtime:** `NEXT_PUBLIC_SUPABASE_*`, server-only credentials,
  VAPID/cron settings, GitHub CI, and Vercel runtime configuration.

`supabase/schema.sql` is a legacy/bootstrap reference and MUST NOT be treated
as current production schema authority unless freshly recertified. Production
schema handover truth derives from read-only live catalog, live data/export,
the recorded Owner-applied migration boundary, immutable repository migrations,
and current application source.

This map omits credentials, project IDs, row counts, volatile metrics, and
detailed schema. It is not a Supabase migration inventory; phase into focused
evidence before any write.
