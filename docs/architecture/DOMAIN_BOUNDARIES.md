# Domain Boundaries

## CURRENT

| Domain | Primary boundary |
|---|---|
| Calls | `src/lib/callLogs/`, `/api/call-logs/*` |
| Field visits | `src/lib/fieldVisits/`, `/api/field-visits/*`, admin visit APIs |
| Follow-ups | `src/lib/followUps.ts`, call/visit source records |
| Attendance | attendance APIs and local attendance records |
| Team KPI | `/api/team-kpi`, `src/lib/teamKpi/` |
| Pipeline | pipeline stage/service modules |
| Mappings/queries | mapping and query modules/routes |
| Auth | Supabase session clients, auth context, protected APIs |

## INVARIANT

Ownership and authority crossings are explicit. Critical client persistence reaches Supabase through approved confirmation routes.

## KNOWN DEBT

Shared tasks and reporting span multiple domains and require cross-contract review.
