# Supabase guidance

Read `docs/architecture/DATA_AUTHORITY.md` and the affected domain contract.

- All schema, RLS, migration, auth, and foundational persistence work is R3.
- Perform a read-only audit first.
- Do not apply migrations without explicit authorization.
- Do not create destructive migrations.
- Never infer production schema solely from local migrations.
- Never run production mutation SQL as verification.
- Keep service-role credentials out of client code, logs, docs, tests, and CI.
