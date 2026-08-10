# System Map

## CURRENT

- `src/app/`: Next.js UI and route handlers.
- `src/app/api/`: authenticated server boundaries for confirmations, reporting, and administration.
- `src/lib/db.ts`: Dexie local stores and sync queue.
- `src/lib/callLogs/`, `src/lib/fieldVisits/`: critical local repository/synchronization logic.
- `src/lib/teamKpi/`: server-report contract and aggregation.
- `supabase/`: local schema/migration evidence and manual verification assets.
- `src/lib/__tests__/`: contract and regression suite.

## INVARIANT

Browser state provides offline durability; server-confirmed data provides cross-device authority. Server routes own privileged authorization.

## KNOWN DEBT

Some older modules combine domain, sync, and presentation concerns. Historical migration variants require compatibility handling.
