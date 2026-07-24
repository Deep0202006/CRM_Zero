# ZeroData Enterprise OS — Full Architecture & Implementation Guide

This document is a comprehensive, deeply technical breakdown of the **ZeroData** (formerly Zero CRM) Enterprise Operating System. It is designed to allow any AI agent or developer to understand the full data model, architecture, business workflows, and underlying sync logic without having to crawl the codebase.

---

## 1. System Architecture & Tech Stack

ZeroData is an offline-first Progressive Web App (PWA) built for Field Agents, Support Staff, and Administrators.

- **Frontend Framework:** Next.js (App Router) + React
- **Styling:** Tailwind CSS + Lucide React for iconography
- **State Management:** React Context API (`AuthContext`)
- **Local Database:** Dexie.js (IndexedDB wrapper) — the definitive source of truth for the UI
- **Remote Database:** Supabase (PostgreSQL) — the cloud sync target
- **Validation:** Zod schemas
- **Deployment:** Vercel (or similar Node.js/Next.js hosting)

### 1.1 The Offline-First Sync Engine
Because field agents operate in variable network conditions, the UI *never* communicates directly with Supabase for data fetching or mutations.
- **Read Path:** All data displayed in the UI is read from local Dexie tables (`db.ts`).
- **Write Path:** Every mutation inserts/updates data locally in Dexie first, then queues a sync job.
- **Sync Queue:** Mutations are passed to `queueOfflineMutation(tableName, action, data)`, inserting an operation into the `sync_queue` table.
- **Sync Processor:** `processSyncQueue()` drains the queue. It triggers on the browser `online` event or via a 60-second periodic heartbeat. 
- **Retry & Dead-Lettering:** Each item in `sync_queue` has a `retry_count`. If a Supabase mutation fails 5 times, it is "dead-lettered" (retained in the queue but skipped in processing). This prevents a malformed request from blocking subsequent requests.

### 1.2 Data Partitioning (Role-Based Access)
To keep the local database small and secure, incoming sync data is filtered through `filterSyncStream(items, userCapabilities, leadsLookup)`.
- Admins / Tech Support receive full data.
- Retailer-oriented roles (`ret_onboarding`, `ret_support`, `field_ret`) only receive leads with `segment_type === "Retailer"`.
- Distributor-oriented roles only receive `Distributor` leads.

---

## 2. Core Entities & Dexie Schema (Version 4)

The local Dexie schema (`src/lib/db.ts`) defines 15 active tables.

### 2.1 Users & Capabilities
- **`users`**: `{ user_id, name, email, password, is_active, manager_id, created_at }`
- **`capabilities`**: `{ code, label }` (e.g., `admin`, `dist_onboarding`)
- **`user_capabilities`**: Maps Users to Capabilities. Evaluated on login to determine access level.

### 2.2 Leads & Pipelines
- **`leads`**: `{ lead_id, business_name, segment_type, status, assigned_to, stage_entered_at, lead_source, area, renewal_date, ... }`
- **`lead_registration_checklist`**: `{ checklist_id, lead_id, gst_certificate_uploaded, pan_uploaded, drug_licence_uploaded, bill_photo_uploaded }`
- **`lead_installation_details`**: `{ installation_id, lead_id, staff_trained_count, proof_photo_url, ... }`
- **`lead_payment_details`**: `{ payment_id, lead_id, amount, paid_at, ... }`

### 2.3 Operations & Support
- **`client_queries`**: Support tickets. `{ query_id, lead_id, client_problem, problem_status, resolution_notes, ... }`
- **`internal_tickets`**: Tech/Admin tickets. `{ ticket_id, category, priority, status, description, ... }`
- **`mappings` & `mapping_requests`**: Connects Retailers to Distributors.
- **`attendance`**: Daily clock-in/out records including geo-coordinates and selfie URLs.
- **`call_logs`**: History of communications for specific leads.

### 2.4 Tasks & KPIs
- **`task_templates`**: Admin-defined daily tasks based on capabilities (e.g., "Visit 4 shops" for `field_ret`).
- **`tasks`**: Instantiated daily instances of tasks for a user.
- **`task_status_history`**: Audit trail of when tasks moved from Pending -> In Progress -> Completed.
- **`kpi_snapshots`**: Daily rollups of metrics (tasks completed, calls logged, leads converted).

---

## 3. Strict Pipeline & Validation Constraints

Lead progression is hard-gated by strict linear transitions defined in `src/lib/validation.ts`.

### 3.1 Pipeline Stages
The explicit, single source of truth for Lead pipeline stages is:
1. `New`
2. `Contacted`
3. `Interested` (Or `Not Interested`)
4. `Registration`
5. `Installation`
6. `Payment`
7. `Renewal Due`

### 3.2 Transition Rules (`ALLOWED_TRANSITIONS`)
- `New` → `Contacted`
- `Contacted` → `Interested` OR `Not Interested`
- `Interested` → `Registration`
- `Not Interested` → `Contacted` (Re-engagement)
- `Registration` → `Installation`
- `Installation` → `Payment`
- `Payment` → (Cannot be manually advanced. A backend cron shifts this to `Renewal Due` when `renewal_date` is reached).
- `Renewal Due` → `Payment` OR `Not Interested`

### 3.3 Stage Validations
- **Registration**: Advancing from Registration requires submitting the 4 boolean checks in `lead_registration_checklist` (GST, PAN, Drug Licence, Bill Photo).
- **Support**: Closing a `client_query` (from "Open/In Progress" to "Resolved") explicitly requires `resolution_notes` to be populated.

---

## 4. Workflows & Subsystems

### 4.1 Task Engine (`src/lib/taskEngine.ts`)
The Task Engine runs when a user logs in or clocks in.
1. Evaluates the user's `userCapabilities`.
2. Queries `task_templates` where `applies_to_capability` matches the user's roles.
3. Generates new `LocalTask` records for the current date.
4. Queries all `tasks` for the user where `due_date <= today` AND `status !== 'Completed'`. This ensures incomplete tasks from previous days carry over as "Overdue".
5. Separates stats into `pendingToday` (due today or overdue) and `scheduledLater` (due tomorrow or beyond) via `getMyDayStats()`.

### 4.2 Onboarding Flow
- Found in `/onboarding`.
- Uses UI Modals for each stage transition.
- When shifting `Registration -> Installation`, the `RegistrationModal` handles checklist checkboxes.
- When shifting `Installation -> Payment`, the `InstallationModal` handles training counts and software version inputs.

### 4.3 KPI & Funnel Analytics
- Found in `/manager/kpi`.
- **FunnelTab.tsx**: Calculates conversion rates dynamically using local Dexie aggregates, mapping leads into their respective Pipeline arrays.
- **LeaderboardTab.tsx**: Rolls up metrics from `kpi_snapshots` to rank employees based on performance.

### 4.4 Automated Renewals
- Renewals are managed on the Supabase backend via a PostgreSQL function `process_renewals(target_date DATE)`.
- It scans all leads in `Payment` where `renewal_date <= target_date`.
- It updates the lead status to `Renewal Due` and inserts an automated Task for the assigned agent to follow up on the renewal.

---

## 5. Implementation Notes & Best Practices

1. **Changing Schema:**
   - Always increment the Dexie `.version(X)` block in `src/lib/db.ts`. Do NOT modify older `.version()` blocks; append the new tables/columns to the newest version block.
2. **Branding:**
   - The application is named **ZeroData**. The tagline is **"Your data is yours"**.
   - Logos are sourced from `/public/logo-icon.png` and `/public/logo-full.png`.
3. **Database Rules (RLS):**
   - The PostgreSQL backend uses Row Level Security (RLS). Ensure Supabase roles map cleanly to the capabilities defined locally if applying hard backend filters.
4. **Validation Updates:**
   - Any new transitions must be explicitly added to `ALLOWED_TRANSITIONS` in `validation.ts`. The UI explicitly relies on this object to enable/disable transition buttons.
