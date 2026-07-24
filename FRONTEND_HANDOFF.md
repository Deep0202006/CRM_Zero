# FRONTEND HANDOFF MANIFEST: CRM ZERO

**Target System:** CRM Zero Operational Intelligence Workspace  
**Framework:** Next.js 16.2.9 (App Router, Turbopack)  
**Package Manager:** npm  
**Root Directory:** `c:\Users\dcp69\Desktop\CRM_Zero`  

---

## 1. Environment & Setup Commands

- **Installation Command:** `npm install`
- **Development Command:** `npm run dev`
- **Production Build Command:** `npm run build`
- **Test Commands:** `npm run build` (Next.js typecheck & static route compilation)
- **Main Application URL & Login Route:**
  - Main App URL: `http://localhost:3000/`
  - Login Route: `http://localhost:3000/login`

---

## 2. Route Inventory (All 19 Active Routes)

1. `/` — Operational Intelligence Overview Dashboard
2. `/login` — Biometric & Password Authentication
3. `/my-day` — Daily Execution Task & Field Targets Queue
4. `/onboarding` — Lead Onboarding Pipeline Workspace (Kanban & Table)
5. `/mappings` — Distributor-Retailer Linkage Logger & Queue
6. `/support` — Client Query Support Desk & Resolution Modal
7. `/call-logs` — Manual Call History Logger & Audit Stream
8. `/attendance` — Field/Office Staff Biometric Check-In
9. `/admin` — System Control & Capability Matrix Console
10. `/admin/attendance` — Team Attendance Overview & CSV Exporter
11. `/manager/kpi` — Team KPI Dashboard & Pipeline Funnel Visualization
12. `/manager/tasks` — Bulk Excel Task Assignment Workspace
13. `/_not-found` — 404 Route Fallback
14. `/api/admin/create-user` — Serverless User Creation Route
15. `/api/admin/reset-password` — Serverless Password Reset Route
16. `/api/admin/update-user` — Serverless User Update Route
17. `/api/task-upload` — Serverless Task Ingestion Route

---

## 3. Structural File Locations

- **Global Styles & Theme Config:** `src/design-system/tokens.css` & `src/app/globals.css`
- **Application Shell:** `src/components/DashboardLayout.tsx`
- **Login-Page Files:** `src/app/login/page.tsx`
- **API Configuration & Clients:**
  - Supabase Client: `src/lib/supabaseClient.ts`
  - Dexie Local DB Sync: `src/lib/db.ts`
  - Task Engine: `src/lib/taskEngine.ts`
  - Validation Rules: `src/lib/validation.ts`
  - Excel 15-Col Exporters: `src/lib/excelExport.ts`, `src/lib/pipelineExport.ts`, `src/lib/clientQueriesExport.ts`

---

## 4. Installed Libraries & Dependencies

- **UI & Icon Libraries:** Lucide React (`lucide-react`)
- **Data Tables & Parsers:** XLSX (`xlsx`), Custom Table Primitives
- **Data Visualization & Charts:** Recharts (`recharts`)
- **Database & Sync:** Dexie (`dexie` v4.4.0), Supabase JS (`@supabase/supabase-js`)
- **Shared Packages Required:** None (Self-contained Next.js workspace)

---

## 5. Build & Runtime Status

- **Known Build Errors:** 0 errors (`npm run build` compiled 100% clean across all 19 routes).
- **Demo Login Credentials:** Demo credentials require seeded local DB users or Supabase Auth session credentials (passwords excluded).

---

## 6. Excluded File Log & Reason for Exclusion

- `.env` / `.env.local` / `.env.production`: Excluded (Contains Supabase service keys and database credentials).
- `node_modules/`: Excluded (Third-party package binaries; easily reinstalled via `npm install`).
- `.git/`: Excluded (Local git version control object directory).
- `.next/`: Excluded (Next.js build output cache).
- `crm-frontend-handoff.zip`: Excluded (Generated handoff archive).
