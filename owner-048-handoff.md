# Owner Migration 048 Gate

Exact migration: `supabase/migrations/048_field_visit_erp_observation.sql`
SHA-256: `1BC9D4787FAECC309DB9960EF446E8B4172AD444E8386F6475F2640937612D61`

Apply the exact migration file manually only after the read-only precheck passes. It is forward-only, adds nullable ERP observation columns and performs zero backfill. The service-only confirmation function has all privileges revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execute permission.

Expected delta: two `field_visits` columns, one check constraint, one latest-business aggregate index, one service-only confirmation function, and one service-only analytics function. It does not mutate `distributor_accounts`, `leads`, receivables, payments, renewal, calls, or historical Field Visits.

If a correction is needed after Owner application, create Migration 049; never edit Migration 048 or any earlier immutable migration.
