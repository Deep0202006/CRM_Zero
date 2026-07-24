# 00 Current State Audit: Operational Intelligence Workspace Redesign

**Project:** CRM Zero  
**Framework:** Next.js 16.2.9 (App Router, Turbopack), React 19.2.4, TypeScript 5.x, Tailwind CSS v4  
**Date:** July 24, 2026  

---

## 1. Executive Summary & Audit Baseline
CRM Zero is an authenticated corporate operations platform used for daily lead pipeline tracking, distributor/retailer mapping, client support query resolution, manual call logging, field target completion, and bulk task allocations.

This audit establishes the baseline for transforming CRM Zero into an **Operational Intelligence Workspace** inspired by Attio, Linear, Stripe Dashboard, Vercel Geist, Plane, and Twenty CRM.

---

## 2. Core Architecture & Tech Stack Inspection
- **Routing Engine:** Next.js 16.2.9 App Router (`src/app/`)
- **State & Local Persistence:** Dexie.js (IndexedDB) with transactional sync queue (`db.ts`)
- **Backend & Auth:** `@supabase/supabase-js`, `@supabase/ssr`, `AuthContext.tsx`
- **Component Libraries:** Custom UI Primitives + Lucide React (`lucide-react`) + Recharts (`recharts`)
- **Validation & Parsers:** Zod 4 (`zod`), XLSX (`xlsx` 15-column parser)

---

## 3. Mandatory Invariants (Non-Negotiable)
1. **Zero Backend Mutation:** Database schemas, Supabase RPCs (`allocate_city_task_batch`), Dexie schemas, and API contracts remain 100% untouched.
2. **Zero Breaking Workflow Changes:** All active routes remain in their exact functional positions.
3. **Identity Vector Standard:** Customer/user card format:
   $$\text{"{Name} (@{Username}) - {Phone}"}$$
4. **15-Column Excel Parser:** `[Username, Name, Address, Area, City, State, Mobile, Email, PSPACode, Third-Party Code, Dlic1, Dlic2, Dlic3, Dlic4, FoodLicense]`.
5. **Single Action Completion Button:** All follow-up and task queues render ONLY ONE action button labeled **"Done"**.
6. **Admin Data Overrides:** Admin role queries bypass local user isolation checks; all metrics evaluate against UTC baselines (`toISOString()`).

---

## 4. Current State Identification & Deficiencies
- **Page Composition:** Excessive reliance on floating cards rather than full-width data workspaces.
- **Record Inspection:** Lacks a persistent right-side record preview inspector for rapid triage.
- **Contextual Actions:** Action bars do not dynamically update based on row selection.
- **View Management:** Missing saved table, board, and activity views.
