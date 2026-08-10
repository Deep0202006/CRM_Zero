# ZeroData Architecture

## CURRENT

ZeroData is a Next.js 16 application with React client experiences, Next.js route handlers, Supabase persistence/authentication, and Dexie/IndexedDB local durability. Critical calls and field visits are retained locally and confirmed through server routes. Admin reporting, including Team KPI, reads confirmed server data.

Read the focused maps: [system](docs/architecture/SYSTEM_MAP.md), [data authority](docs/architecture/DATA_AUTHORITY.md), [boundaries](docs/architecture/DOMAIN_BOUNDARIES.md), and [critical flows](docs/architecture/CRITICAL_FLOWS.md).

## INVARIANT

Server-confirmed rows are cross-device authority. IndexedDB is durable offline/recovery state, not permission to overwrite confirmed server truth. Privileged secrets and authorization remain server-side. Stable business IDs make retries idempotent.

## KNOWN DEBT

Schema history and compatibility paths are broad, historical repair documents overlap, and some domain policy remains distributed across components, routes, tests, and migrations. Production schema cannot be inferred solely from local migrations.
