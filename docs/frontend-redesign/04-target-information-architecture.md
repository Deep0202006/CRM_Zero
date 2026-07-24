# 04 Target Information Architecture: CRM Zero

## Navigation Grouping Hierarchy (Max 7 Top-Level Navigation Groups)

```text
├── 1. Execution
│   ├── My Day (/my-day)
│   └── Log Call (/call-logs)
├── 2. Operations
│   ├── Pipeline (/onboarding)
│   ├── Client Support (/support)
│   └── Mappings (/mappings)
├── 3. Field & Attendance
│   └── Attendance (/attendance)
└── 4. Administration & Management
    ├── Admin Control (/admin)
    ├── Assign Task (/manager/tasks)
    ├── Team KPIs (/manager/kpi)
    ├── Team Attendance (/admin/attendance)
    └── System Insights (/)
```

## Shell & Workspace Specifications
- **Desktop Sidebar:** Dark Graphite (`--surface-sidebar: #121418`). Width: `248px` (expanded) / `72px` (collapsed).
- **Top Utility Bar:** `56px` height. Includes Breadcrumbs, Scope Switcher, `Cmd + K` Command Palette Trigger, Sync Queue Badge, User Avatar.
- **Persistent Right Inspector:** `380px` drawer on desktop for immediate record inspection without leaving the active queue.
