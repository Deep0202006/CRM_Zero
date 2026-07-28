# Current architecture

Supabase contains the confirmed business tables, but the application historically treated Dexie as both cache and authority. `src/lib/db.ts` owns local tables, generic writes, pull sync, queue processing, and a broad Realtime subscription. `src/lib/fieldVisits/sync.ts` introduced a second processor. Team KPI accumulated snapshot, raw-table, ledger, and API fallback implementations.

Confirmed defects:

- generic mutations generated a new random idempotency key;
- queue entries stopped retrying after five failures;
- field visits bypassed the generic queue and accepted duplicate-key text as confirmation;
- logout signed out before flushing and then cleared every Dexie table;
- operational pages commonly read Dexie without a completed user-scoped bootstrap;
- Team KPI API used RPC v4 and a service-role raw-table fallback;
- KPI Realtime subscribed to every raw source table;
- visit APIs used service-role clients and unbounded result sets;
- empty remote reads were ambiguous and bootstrap pagination was incomplete.

Migration `030` is the forward-only repair package. Production SQL is not applied by this repository change.
