# ACTIVITY DECK REMOVAL STATE

- Route removed: Yes
- Navigation removed: Yes
- Components removed: Yes
- API removed: Yes
- Database writes stopped: Yes
- Dexie store removed or retained: N/A (Not heavily used in Activity Deck)
- Sync handlers removed or retained: Retained (Used by core workflows)
- Realtime subscription removed or retained: Retained (For other features)
- Remaining repository references: Removed from UI, potentially present in older migrations (023)
- Shared business tables retained: Yes (calls, tasks, etc. are core)
- Database objects proposed for later removal: `get_team_kpi_daily` RPC (if completely unused)
