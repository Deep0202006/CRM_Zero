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
| Team Chat | `src/lib/teamChat/`, `/api/chat/*`, `/api/push/*`, `chat_*` tables |

## INVARIANT

Ownership and authority crossings are explicit. Critical client persistence reaches Supabase through approved confirmation routes.

## KNOWN DEBT

Shared tasks and reporting span multiple domains and require cross-contract review.
Team Chat V1 uses the existing user identity boundary and does not create a second employee directory.
