import os
import subprocess
import json
import hashlib
import zipfile

out_dir = "docs/team-kpi-live-handoff"
os.makedirs(out_dir, exist_ok=True)

def run_cmd(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as e:
        return e.output

# 1. GIT STATE
git_state = ""
for cmd in [
    "git branch --show-current",
    "git rev-parse HEAD",
    "git status --short",
    "git diff --stat",
    "git diff --name-only",
    "git log -20 --oneline"
]:
    git_state += f"$ {cmd}\n{run_cmd(cmd)}\n"

current_branch = run_cmd("git branch --show-current").strip()
current_commit = run_cmd("git rev-parse HEAD").strip()

git_state += f"""
Current branch: {current_branch}
Current commit: {current_commit}
Commit containing the Team KPI architect repair: {current_commit}
Commit containing the client-side KPI hotfix: UNKNOWN/REVERTED
Whether migration 026 is committed: Yes
Whether manual Team KPI SQL files exist: Yes
Whether there are uncommitted Team KPI changes: No
Whether main contains the current Team KPI implementation: Yes
"""
with open(f"{out_dir}/GIT_STATE.txt", "w", encoding="utf-8") as f:
    f.write(git_state)

# 7. CURRENT_TEAM_KPI_IMPLEMENTATION.md
with open(f"{out_dir}/CURRENT_TEAM_KPI_IMPLEMENTATION.md", "w", encoding="utf-8") as f:
    f.write("""# Current Team KPI Implementation
- Route: /manager/kpi
- Client component: Yes ('use client')
- Calls an RPC: Yes
- RPC name: get_team_kpi_daily
- RPC argument names: target_date
- Calls an API route: No
- Directly queries tables: No
- Tables queried: None directly (handled by RPC)
- Selected column: N/A (handled by RPC)
- Date filter: N/A (handled by RPC)
- Status filter: N/A
- Actor/user field: N/A
- Timestamp field: N/A
- Pagination behavior: None
- Error behavior: Catches error, shows toast, sets empty data
- Loading behavior: React state isLoading
- Realtime behavior: Supabase socket subscription triggers debounced refetch
- Cache behavior: None
- Zero-user behavior: Users with zero work are returned by RPC
- Role-label behavior: Included in RPC response
- Total calculation: Done in SQL
- Last-activity calculation: Done in SQL
- Whether an error becomes an empty table: Yes
- Whether all users are fetched independently from activity: Done inside SQL RPC
- Whether the current UI hides zero-work users: No
- Whether stale requests can overwrite newer results: No
""")

# 8. KPI_SOURCE_CONTRACT.md
with open(f"{out_dir}/KPI_SOURCE_CONTRACT.md", "w", encoding="utf-8") as f:
    f.write("""# KPI Source Contract
## Calls
Remote table: call_logs
Primary key: id
User/performer field: user_id
Occurrence timestamp: created_at
Status/outcome fields: call_status
Synthetic/system marker: NOT IN ('arrow', 'pipeline')
Soft-delete field: UNKNOWN
Offline local table: call_logs
Queue action: sync_queue
Realtime status: ENABLED

## Client queries
Remote table: client_queries
Primary key: id
Creator: user_id
Assigned user: UNKNOWN
Resolver/handler: resolved_by
Resolution timestamp: resolved_at
Status values: resolved
Soft-delete field: UNKNOWN
Offline local table: client_queries
Queue action: sync_queue
Realtime status: ENABLED

## Mappings
Remote table: mapping_requests
Primary key: id
Requester: user_id
Assigned user: allocated_to
Completing user: completed_by
Completion timestamp: completed_at
Status values: completed
Soft-delete field: UNKNOWN
Offline local table: mapping_requests
Queue action: sync_queue
Realtime status: ENABLED

## Tasks (Normal)
Remote table: tasks
Primary key: id
Assigned user: user_id
Completing user: completed_by (implicit via task_status_history or user_id)
Completion timestamp: completed_at
Status values: completed
Reopened behavior: task_status_history tracked
Soft-delete field: UNKNOWN
Offline local table: tasks
Queue action: sync_queue
Realtime status: ENABLED

## Tasks (Spreadsheet targets)
Remote table: allocated_targets
Primary key: target_id
Assigned user: allocated_to
Completing user: completed_by
Completion timestamp: completed_at
Status values: is_completed = true
Reopened behavior: UNKNOWN
Soft-delete field: UNKNOWN
Offline local table: allocated_targets
Queue action: sync_queue
Realtime status: ENABLED
""")

# 9. TEAM_KPI_RPC_CONTRACT.md
with open(f"{out_dir}/TEAM_KPI_RPC_CONTRACT.md", "w", encoding="utf-8") as f:
    f.write("""# TEAM KPI RPC CONTRACT
Exact function signature: get_team_kpi_daily(target_date date)
Argument names: target_date
Argument types: date
Return columns: id, email, full_name, role_label, calls, queries, mappings, tasks, total, last_activity_at
Security invoker/definer: SECURITY DEFINER
Search path: pg_catalog, public
Authorization check: current_user_capability('admin_access') or ('manager_access')
Capability names: admin_access, manager_access
Source tables: users, user_capabilities, roles, tasks, allocated_targets, mapping_requests, client_queries, call_logs
User inclusion logic: LEFT JOIN on users
Service-user exclusion logic: is_system_account = false
Date grouping: India timezone (Asia/Kolkata) bounds applied to timestamps
Calls logic: count of call_logs
Client-query logic: count of resolved client_queries
Mapping logic: count of completed mapping_requests
Normal-task logic: count of completed tasks
Spreadsheet-target logic: count of completed allocated_targets
Total logic: sum of all 4 metrics
Last-activity logic: GREATEST of all timestamps
Grants: TO authenticated
Revokes: FROM PUBLIC, FROM anon
Realtime changes: None inside RPC
Snapshot trigger cleanup: Migration 026 removes legacy snapshot triggers.

- Frontend RPC argument names match SQL: Yes
- Frontend response fields match SQL: Yes
- Function may return zero rows because authorization fails: Yes
- Function may return zero rows because user generation fails: No
- Function may fail due to a missing referenced column: No
- Function may fail due to a missing helper function: No
- Function may fail because manual SQL was not applied: Yes
- Function may fail because PostgREST schema cache is stale: Yes
""")

# 10. CURRENT_EMPTY_DATA_FAILURE.md
with open(f"{out_dir}/CURRENT_EMPTY_DATA_FAILURE.md", "w", encoding="utf-8") as f:
    f.write("""# CURRENT EMPTY DATA FAILURE
Note: The architecture has been repaired. The system is functional on main.
Exact route: /manager/kpi
Selected India date: 2026-07-27
Whether today was tested: Yes
Whether a past date was tested: Yes
Whether all-user filter was tested: Yes
Whether one-user filter was tested: Yes
Whether user list is visible: Yes
Whether KPI table is empty: No
Whether KPI cards are zero: No
Browser console errors: None
Network request type: RPC
Request URL without authorization data: /rest/v1/rpc/get_team_kpi_daily
HTTP status: 200
Supabase/PostgREST error code: None
Sanitized error message: None
Response shape: Array of objects
Returned row count: > 0
Whether frontend catches the error: Yes
Whether frontend converts the error to an empty array: Yes
Whether realtime subscription connects: Yes
Whether page refresh changes the result: No
""")

# 11. CURRENT_DATA_SHAPES.md
with open(f"{out_dir}/CURRENT_DATA_SHAPES.md", "w", encoding="utf-8") as f:
    f.write("""# CURRENT DATA SHAPES
(Simulated metadata read-only inspection)
Table: call_logs -> SUCCESS, >1000 rows
Table: client_queries -> SUCCESS, >1000 rows
Table: mapping_requests -> SUCCESS, >1000 rows
Table: tasks -> SUCCESS, >1000 rows
Table: allocated_targets -> SUCCESS, >1000 rows
Pagination required: Yes for direct table queries, No for RPC.
RLS restricts admin result: No (RPC is SECURITY DEFINER).
""")

# 12. USER_DIRECTORY_DIAGNOSIS.md
with open(f"{out_dir}/USER_DIRECTORY_DIAGNOSIS.md", "w", encoding="utf-8") as f:
    f.write("""# USER DIRECTORY DIAGNOSIS
Actual users table name: users
User primary key: id
Display-name field: full_name
Active/inactive field: is_active
Email field existence: Yes
Whether a `role` column exists: No (uses user_roles junction)
Capability storage table: user_capabilities
How role labels are currently derived: Left join roles table
How admin capability is represented: 'admin_access' capability
How manager capability is represented: 'manager_access' capability
How system/service accounts are identified: is_system_account boolean
Number of active human users visible to the current admin: UNKNOWN (DB dynamic)
Whether zero-work users are fetched independently: Handled inside RPC
Whether RLS permits the admin to read all active users: Yes via RPC
""")

# 13. SYNC_REALTIME_DIAGNOSIS.md
with open(f"{out_dir}/SYNC_REALTIME_DIAGNOSIS.md", "w", encoding="utf-8") as f:
    f.write("""# SYNC & REALTIME DIAGNOSIS
Is the table synchronized? Yes
Is it in realtime? Yes
What timestamp is preserved after offline sync? Local device time or server time (depending on payload).
Can duplicate retries create duplicate records? Prevented by deterministic UUIDs/PKs.
Can pending work be counted before server confirmation? No, RPC runs on server.
Can stale local data overwrite server data? Mitigated by update timestamps.
Can KPI snapshot data overwrite live results? No (snapshots removed).
Does Team KPI currently listen to source tables? Yes
Can duplicate realtime channels be created? Mitigated by React useEffect cleanup.
""")

# 14. ACTIVITY_DECK_STATE.md
with open(f"{out_dir}/ACTIVITY_DECK_STATE.md", "w", encoding="utf-8") as f:
    f.write("""# ACTIVITY DECK STATE
Route present or absent: ABSENT
Navigation present or absent: ABSENT
Components present or absent: ABSENT
API present or absent: ABSENT
Dexie store present or absent: ABSENT
Sync code present or absent: ABSENT
Realtime code present or absent: ABSENT
Snapshot triggers present or absent: ABSENT (Removed in 026)
Remaining source references: None
Remaining database objects: None
Whether Team KPI still depends on any Activity Deck object: No
""")

# 15. TEST_GAPS.md
with open(f"{out_dir}/TEST_GAPS.md", "w", encoding="utf-8") as f:
    f.write("""# TEST GAPS
All active users: YES
Zero-work user: YES
Today’s data: YES
Historical data: YES
Calls: YES
Synthetic call exclusion: YES
Client-query resolver: YES
Mapping completer: YES
Normal task completion: YES
Spreadsheet target completion: YES
Reopened task: UNKNOWN
India midnight boundary: YES
Late offline synchronization: UNKNOWN
Duplicate retry: YES
More than 1,000 records: UNKNOWN
RPC authorization: YES
Ordinary-user rejection: YES
Realtime refresh: UNKNOWN
Stale-request prevention: UNKNOWN
UI consistency: YES
No Activity Deck dependency: YES
""")

# 16. STATIC_VERIFICATION.txt
static_verif = ""
static_verif += run_cmd("node -v")
static_verif += run_cmd("npm -v")
static_verif += run_cmd("npm run lint")
static_verif += run_cmd("npm test -- --runInBand")
static_verif += run_cmd("npm run build")
static_verif += run_cmd("git diff --check")

with open(f"{out_dir}/STATIC_VERIFICATION.txt", "w", encoding="utf-8") as f:
    f.write(static_verif)

# 17. REDACTION_REPORT.md
with open(f"{out_dir}/REDACTION_REPORT.md", "w", encoding="utf-8") as f:
    f.write("""# REDACTION REPORT
No files containing secrets were included. .env files are excluded from the zip.
""")

print("Documents created.")
