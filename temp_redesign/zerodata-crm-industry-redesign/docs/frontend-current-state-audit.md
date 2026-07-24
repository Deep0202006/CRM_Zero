# CRM Zero Frontend Current State Audit & Phase 0 Contract

**Date:** July 24, 2026  
**Target:** CRM Authenticated Application Layer & User Interface Ecosystem  
**Framework Version:** Next.js 16.2.9 (App Router, Turbopack) / React 19.2.4 / TypeScript 5.x / Tailwind CSS v4  

---

## 1. System Architecture & Tech Stack Overview

### Framework & Core Libraries
- **Core Engine:** Next.js 16.2.9 (`app` directory routing), React 19.2.4, TypeScript 5.x
- **Styling Strategy:** Tailwind CSS v4 (`@tailwindcss/postcss`), Custom CSS Variables, Lucide React (`lucide-react`) icons
- **State Management & Local Persistence:** Dexie.js 4.4.4 (IndexedDB local database) with transactional background synchronization (`db.ts`)
- **Data & Auth:** `@supabase/supabase-js` 2.110.0, `@supabase/ssr` 0.12.0
- **Analytics & Exports:** `recharts` 3.9.1, `xlsx` 0.18.5, `zod` 4.4.3

---

## 2. Active Application Routes & Component Audit

| Route | Purpose & Primary Role | Key Components & Logic |
| :--- | :--- | :--- |
| `/` | Root Pipeline & Lead Workspace | Lead pipeline tables, status filters, call log modals, search |
| `/login` | Authentication & Biometric Portal | Session login, credentials, AuthContext integration |
| `/my-day` | Daily Task & Field Targets Execution | `TaskCard` queue, Field Target list, Role-scoped KPIs |
| `/mappings` | Mapping Queue | Distributor & Retailer mapping requests, claim & approval flow |
| `/onboarding` | Onboarding Pipeline | Lead conversion, registration stage movement, pipeline exports |
| `/support` | Client Queries & Support Desk | Query status filters, resolution tracking, assignment |
| `/call-logs` | Global & Personal Call History | Timestamps, call outcomes, lead identity tracking |
| `/attendance` | Field Staff Attendance | Check-in / check-out biometric & location logging |
| `/admin` | Admin Command Center | User capability management, capability toggles, password resets |
| `/admin/attendance` | Admin Attendance Overview | Team attendance logs, date filters |
| `/manager/kpi` | Manager Performance Dashboard | Team metrics, conversion rates, Recharts visualizations |
| `/manager/tasks` | Task Allocation & Bulk Excel Workspace | `TaskAllocationWorkspace.tsx`, 15-column Excel upload, city mapping |

---

## 3. Core System Invariants & Business Logic Rules

1. **Zero Backend & Schema Mutation:** API endpoints, Supabase RPCs, database schemas, and Dexie IndexedDB schemas remain 100% untouched.
2. **Workflow & Layout Positions:** Navigation structures, route boundaries, and core workflows remain in their exact functional locations.
3. **Identity Vector Formatting Standard:** Every user/customer card across all queues strictly adheres to:
   $$\text{Format: } \text{"{Name} (@{Username}) - {Phone}"}$$
4. **Excel 15-Column Upload Schema:** Bulk task allocation maps the exact 15 columns:
   `[Username, Name, Address, Area, City, State, Mobile, Email, PSPACode, Third-Party Code, Dlic1, Dlic2, Dlic3, Dlic4, FoodLicense]`
5. **Single "Done" Action Button:** Follow-up and daily task cards render ONLY one completion button labeled **"Done"**. The redundant "Start" button and `'IN_PROGRESS'` states are completely removed from JSX/TSX root structures.
6. **Admin Data Overrides & UTC Standardization:** Admin queries bypass local user isolation checks; all metrics and date filters evaluate against UTC baselines (`toISOString()`).
7. **No Code Truncation:** All component refactors emit 100% complete, untruncated, production-ready TypeScript/CSS code.

---

## 4. UI/UX & Accessibility Gap Identification

- **Design System Tokens:** Currently lacks a unified, centralized design token stylesheet with dark mode support.
- **Loading & State Feedback:** Inconsistent Skeleton loaders, fallback states, and Empty states across queue views.
- **Navigation Shell:** App header and sidebar elements require visual polish, smooth transitions, and responsive collapsing.
- **Accessibility (WCAG 2.2 AA):** Need explicit focus rings (`var(--brand-500)`), ARIA roles, and minimum 44px touch targets on mobile viewports.

---

## 5. Target File Assignments for Phase 1 Execution

1. `src/design-system/tokens.css` - [NEW] Central Design Tokens (Color Palette, Surfaces, Typography, Spacing, Geometry, Elevation, Z-Index, Dark Mode)
2. `src/app/globals.css` - [MODIFY] Import tokens, setup global font hierarchy and CSS utility layers.
3. `src/components/ui/` - [NEW] Primitive Component System:
   - `Button.tsx`
   - `Input.tsx`
   - `Card.tsx`
   - `Chip.tsx`
   - `Skeleton.tsx`
   - `EmptyState.tsx`
   - `ErrorBoundary.tsx`
