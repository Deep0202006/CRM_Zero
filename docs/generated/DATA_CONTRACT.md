# Generated Data Contract Summary

## CURRENT

This summary is derived from current TypeScript types, Zod validation, server routes, and local migration evidence.

- Calls: stable `log_id`, explicit `user_id`, timestamp, outcome, client reference, and optional follow-up date; confirmed through the call confirmation route.
- Field visits: stable UUID `visit_id`, owner UUID, lead reference, IST `visit_date`, ISO check-in time, segment/outcome, location/evidence metadata, follow-up fields, and optional attendance link; validated by `FieldVisitSchema` and confirmed through the visit route.
- Follow-ups: derived from stable call/visit source identities, schedule, owner, and confirmed completion evidence.
- Attendance: user-owned attendance records and explicit server confirmation/linkage.
- Team KPI: validated target date, unique employee rows, per-source counts, totals equal to row sums, server aggregation source, and source warnings.
- Pipeline, mappings, and queries: stable identities, explicit assignment/completion/resolution attribution, and compatibility preservation for historical rows.
- Auth/session: Supabase access token at protected server boundaries; service-role use is server-only.

## INVARIANT

Types, validation, routes, and tests describe expected application contracts. Local migrations do not prove actual production schema. Production verification requires explicitly authorized, read-only production introspection.

## KNOWN DEBT

Historical schema variants and compatibility readers mean some optional columns differ across deployments; code must fail conservatively and report warnings.
