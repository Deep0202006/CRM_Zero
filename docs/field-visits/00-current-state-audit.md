# Current State Audit

## Overview
Next.js App Router application with Dexie offline support and Supabase backend.
The current app lacks the Field Visits capability for `field_ret` and `field_dist` roles.

## Technical Stack
- Next.js 16.2.9
- React 19.2.4
- Tailwind CSS v4
- Dexie for offline DB
- Supabase for backend DB

## Defect Findings
- **Focus Jumping / Stale Closure in Modal.tsx**: The `onClose` dependency in `useEffect` resets focus traps.
- **Lead Source Data Contract**: Type mismatches.
- **KPI Remote/Local Sync Alias**: Dexie local table is `kpi_snapshots` but sync queue uses `kpi_daily_snapshot`.
- **Responsive Layouts**: Overflow issues in sidebars / modals instead of proper containment.
