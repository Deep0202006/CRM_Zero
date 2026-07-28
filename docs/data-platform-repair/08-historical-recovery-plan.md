# Historical recovery plan

Recovery sources, in order, are retained Supabase rows, original-device IndexedDB, and verified backup exports. Inspection is read-only first. Legacy `EXCEL::` identifiers are repaired only by moving known identity text out of UUID columns. Actor and timestamps are never guessed.

Recoverable work is deduplicated by semantic operation key and replayed through authenticated commands. Records missing a provable actor or timestamp are reported as unrecoverable.
