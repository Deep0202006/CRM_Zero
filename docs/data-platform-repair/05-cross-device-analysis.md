# Cross-device analysis

The former full pull was device-centric, unpaginated per source beyond the PostgREST default, and insufficiently user-scoped. A newly signed-in device could therefore show empty or another user’s old cache.

The repaired bootstrap:

1. validates the Supabase session;
2. fetches the signed-in user’s visible confirmed rows in pages of 1,000;
3. preserves all entity IDs represented by pending/retry/permanent outbox entries;
4. upserts server rows;
5. stores a per-user bootstrap timestamp;
6. never uploads a local table because a remote response is empty.
