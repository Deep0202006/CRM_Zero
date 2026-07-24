# 02 Component Inventory: CRM Zero

This inventory categorizes all existing and proposed UI components, ensuring component reuse and strict elimination of duplicate visual patterns.

## 1. Core Primitives (`src/components/ui/`)
- `Button.tsx`: Operational control buttons (`sm`, `md`, `lg`, 44px mobile touch target).
- `Input.tsx`: Accessible text/date input fields with focus rings (`--brand-500`).
- `Card.tsx`: Structural cards with `--radius-lg` (12px), border contrast, no unnecessary drop shadows.
- `Chip.tsx`: Semantic status chips (`success`, `warning`, `danger`, `info`, `neutral`, `brand`, `pending`).
- `Skeleton.tsx`: Structural loading placeholders.
- `EmptyState.tsx`: Accessible empty state component.
- `ErrorBoundary.tsx`: Component exception boundary.

## 2. Shared Workspaces & Templates (`src/components/templates/`)
- `DashboardLayout.tsx`: Application Shell with Dark Graphite sidebar (`248px` / `72px`), `56px` top utility bar, search trigger (`Cmd + K`), and mobile drawer.
- `DashboardPageTemplate.tsx`: Standard 8/4 grid layout for operational dashboards.
- `ListPageTemplate.tsx`: Full-width data table layout with toolbar, search, filter chips, and pagination.
- `DetailPageTemplate.tsx`: Split-screen record detail layout with identity header and right-side context inspector.
- `QueueList.tsx`: Operational task & item queue renderer.
- `SearchableSelect.tsx`: Fast searchable dropdown selector.

## 3. High-Density Domain Workspaces
- `TaskAllocationWorkspace.tsx`: 15-column Excel task parser and Supabase RPC batch allocator.
- `CreateUserPanel.tsx`: Admin user creation drawer.
