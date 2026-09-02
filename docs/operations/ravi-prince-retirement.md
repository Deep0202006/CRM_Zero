# Ravi and Prince retirement safety gate

## Current outcome

The Owner can run `supabase/manual/precheck_ravi_prince_retirement.sql` read-only to resolve exactly one profile for each requested identity, detect unexpected Auth rows, emit every current `public`/`auth` UUID dependency count as a `RETIREMENT_DEPENDENCY` notice, and list every foreign key into `public.users`.

No execute or postcheck script is supplied in this packet. Current repository authority forbids deleting `call_logs`, and the Data Lifecycle contract classifies Calls and Attendance as permanent business history. The requested disposition would delete both. The master program says stronger current authority wins, so generating executable deletion SQL would be unsafe even if Codex never ran it.

## Owner procedure

1. Run the precheck in the Supabase SQL Editor. It starts a read-only transaction and rolls back.
2. Save the exact target UUIDs, Auth counts, UUID dependency notices, and foreign-key definitions in an encrypted Owner record outside Git.
3. Confirm that the target match is exactly one `Ravi` and one `Prince`. Any mismatch is a hard stop.
4. Do not run ad-hoc deletion or the existing generic Admin delete-user route for these profiles.
5. Resolve the policy conflict explicitly: either preserve/reassign permanent Calls and Attendance while retiring login/profile visibility, or approve a reviewed change to the non-deletion and lifecycle contracts.
6. Only after that decision, prepare a separate exact-UUID transaction, expected-count guards, rollback/backup procedure, and postcheck from the captured dependency manifest.

The precheck itself performs no durable write, production mutation, schema change, RLS change, Auth change, Storage access, Realtime change, or deployment.
