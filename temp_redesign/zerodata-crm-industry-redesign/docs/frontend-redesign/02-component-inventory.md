# 02 Implemented Component Inventory

## Brand and shell

- `AppLogo.tsx` — responsive ZeroData identity for expanded/collapsed and inverse contexts.
- `DashboardLayout.tsx` — stable shell, permission-aware grouped navigation, responsive drawer, theme control, sync status and user menu.
- `CommandPalette.tsx` — `Ctrl/Cmd + K` route search with keyboard navigation and focus management.

## Core UI primitives

- `Button.tsx` — primary, secondary, outline, ghost and destructive variants with icons and loading states.
- `Input.tsx` — labels, descriptions, errors, required state, leading/trailing controls and accessible associations.
- `Card.tsx` — consistent operational panels.
- `Chip.tsx` — brand and semantic states with optional status dot.
- `Modal.tsx` — focus trap, Escape handling, scroll lock, focus restoration and structured footer.
- `PageHeader.tsx` — consistent title, context, actions and metadata.
- `MetricCard.tsx` — compact decision-oriented metric presentation.
- `Skeleton.tsx` — structural loading placeholders.
- `EmptyState.tsx` — action-oriented empty states.
- `ErrorBoundary.tsx` — branded route/component failure surface.

## Shared operational components

- `RecordInspector.tsx` — keyboard-safe right-side record detail drawer with overview and properties tabs.
- `SearchableSelect.tsx` — accessible combobox behaviour with keyboard navigation.
- `QueueList.tsx` — consistent task and attention queues.
- `TaskAllocationWorkspace.tsx` — spreadsheet validation, city-owner mapping, workload summary and guarded allocation confirmation.
- `CreateUserPanel.tsx` — structured administrator user-creation workflow.
- `DashboardPageTemplate.tsx` and `ListPageTemplate.tsx` — reusable page compositions.

## External free libraries retained

- Lucide React for one consistent icon family.
- Recharts for route-scoped management analytics.
- Tailwind CSS v4 and CSS custom properties for implementation styling.

No paid component library and no second competing UI system were added. The shared component code remains owned by the project, reducing lock-in and visual inconsistency.
