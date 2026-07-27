# Team KPI Repair & Activity Deck Removal - Deployment Runbook

## Overview
This runbook covers the deployment steps for completely removing the `Activity Deck` feature and replacing the Team KPI dashboard with a server-authoritative, real-time database query directly from Supabase.

## Database Migrations
Run the following SQL migration on the production Supabase database:
- `supabase/migrations/025_team_kpi_source_of_truth.sql`

This migration will:
1. Drop the old `compute_daily_kpi_snapshot` functions and triggers.
2. Create the new `public.get_team_kpi_daily(target_date text)` RPC function which aggregates Calls, Client Queries, Tasks, and Mappings on the fly.

## Files Removed
- `src/app/admin/activity/page.tsx`
- `src/components/admin/ActivityDeck.tsx`
- Old KPI related daily functions.

## Expected Behavior
1. The **Activity Deck** will no longer appear in the Admin sidebar navigation.
2. The **Team KPI** page (`/manager/kpi`) will now dynamically render the completion metrics using real-time SQL aggregation via the RPC endpoint instead of relying on legacy snapshots or Dexie local tables.
3. Total completed work accurately reflects cross-domain objects (calls, tasks, mappings, queries).

## Rollback Plan
If issues occur:
1. Revert the frontend commit deleting the Activity Deck and updating the KPI table.
2. No immediate database rollback is required for `025_team_kpi_source_of_truth.sql` since it relies on additive RPC functions. Legacy `kpi_daily_snapshot` table data is preserved.
