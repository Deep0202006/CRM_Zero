# Owner Migration 048 Gate

Exact migration: `supabase/migrations/048_field_visit_erp_observation.sql`
SHA-256: `01A9EF40E6DD87704ED5F17642B94E979C67595BF30228462795A18639867B1E`

Any earlier Migration 048 proof or handoff carrying a different SHA-256 is invalidated and must not authorize application.

Apply the exact migration file manually only after the read-only precheck passes. It is forward-only, adds nullable ERP observation columns, performs zero backfill, and preserves historical NULL as Not captured rather than inventing None. The confirmation and analytics functions have all privileges revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execute permission.

Expected delta: two `field_visits` columns, one check constraint, one latest-business aggregate index, one service-only confirmation function, and one service-only analytics function. ERP resolution and Field Visit insertion are atomic. It does not assign Distributor Status ERP and does not mutate `distributor_accounts`, `leads`, receivables, payments, renewal, calls, or historical Field Visits.

If a correction is needed after Owner application, use a forward-only Migration 049 repair; never edit Migration 048 or any earlier immutable migration.
