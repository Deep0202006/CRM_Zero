# 04 Implemented Information Architecture

## Navigation groups

```text
Workspace
├── My Day
├── Call Logs
├── Pipeline
├── Client Support
└── Mappings

People
├── Attendance
├── Team Attendance
└── Team KPIs

Management
├── Assign Tasks
├── Admin Control
└── Insights
```

Visibility is permission-aware and continues to use the existing authentication/capability model.

## Shell

- Desktop sidebar: `264px` expanded and `76px` collapsed.
- Top utility bar: `64px`.
- Mobile: modal navigation drawer with body scroll lock, focus trap, Escape close and focus restoration.
- Global route search: `Ctrl/Cmd + K` command palette.
- Workspace controls: theme, sync queue status and user menu.
- Record context: shared `460px` inspector on desktop and full-width presentation on smaller screens.

## Composition rules

- Data workspaces use available width rather than narrow marketing containers.
- Forms remain constrained for readability.
- Pages use one clear primary action.
- Operational context is grouped by workflow, not by decorative card count.
- Tables, boards, queues and record drawers share consistent geometry and status language.
