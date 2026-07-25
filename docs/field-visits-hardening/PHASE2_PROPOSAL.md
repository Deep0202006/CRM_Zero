# Phase 2 Proposal

## Defects Phase 2 will fix
- Weak attendance linkage: `field_visits` can currently be created without proving active check-in on the server side.
- Missing Segment Enforcement: Users can insert visits for segments outside their allocated capabilities (`field_ret` vs `field_dist`).

## Files proposed for modification
- `supabase/migrations/022_field_visits_security_linkage.sql` (New)

## Migration Strategy
- **021 Immutable:** Yes, `021_field_visits_hardening.sql` will remain immutable.
- **New Forward-Only Migration:** Yes, a new migration (`022_field_visits_security_linkage.sql`) will be required to amend the RLS policies and apply the constraints.
- **Validation Mechanism:** Validation will use a combination of **RLS policies** (calling helper DB functions to verify capabilities and attendance) and a strict foreign key (if attendance ID is enforced).

## Rollback Strategy
- The rollback strategy involves dropping the new policies created in `022` and reverting back to the policies defined in `021`.

## Local / Development Test Strategy
- Apply migrations using `supabase db reset` locally (once Docker is running and linked).
- Use local seed data representing users with different capabilities (`field_ret`, `field_dist`).
- Run SQL queries simulating inserts by users without active attendance (expecting failure) and with active attendance (expecting success).

## SQL Verification Cases
1. `INSERT INTO field_visits (user_id, segment_type)` where `user_id` lacks `field_ret` and `segment_type` is `Retail`. -> Fails.
2. `INSERT INTO field_visits` without a matching `attendance` record for the `visit_date` in IST. -> Fails.
3. Successful `INSERT` passing both RLS checks.

## Production Deployment Confirmation
- Explicit confirmation: **No production deployment is planned during Phase 2.** All changes will be restricted to migrations, code, and local/development verification.
