
1. Browser route: /manager/kpi
2. Function called: useEffect loadData
3. Request URL: /api/team-kpi?date=...
4. API route file: src/app/api/team-kpi/route.ts
5. How token is passed: Authorization Bearer header
6. Admin checked: GET /api/team-kpi calls isAdmin
7. RPC name: get_team_kpi_daily_v3
8. RPC arg name: target_date
9. RPC arg type: date
10. Expected schema: TeamKpiResponse
11. DB function: get_team_kpi_daily_v3
12. DB table: team_work_events
13. Realtime subscribed: team_work_events, users, user_capabilities
14. Error handling: Throws Error, handled by catch block
15. Zero rows: Returns empty structure
16. Old data: Cleared or overwritten by new state
17. Empty array on error: Error msg set in UI
18. Stale requests: Handled via debouncing / latest fetch wins
19. Legacy aggregation: Removed
20. Fallback: Removed
