# Internal CRM — 1-Week Implementation Roadmap

Small-team build plan. Roles are assigned as **capabilities**, not fixed job titles, so Admin can mix, add, or remove capabilities on any user at any time without changing their login.

---

## 1. Role Model (Flexible, Admin-Controlled)

A user account is not locked to one role. Admin assigns one or more **capabilities** to each account, and can change them at any time from the Admin panel. Example: a person can hold "Distributor Support" today and be switched to "Distributor Support + Retailer Onboarding" tomorrow, with no new account needed.

### Capability List

| Capability Code | What it allows |
|---|---|
| `admin` | Full access to every record, every user, KPI dashboard, and role assignment |
| `dist_onboarding` | Create/manage new Distributor leads through the pipeline |
| `dist_support` | View and resolve queries for existing (converted) Distributor accounts |
| `ret_onboarding` | Create/manage new Retailer leads through the pipeline |
| `ret_support` | View and resolve queries for existing (converted) Retailer accounts |
| `field_dist` | Field visits, biometric attendance, activity logging for Distributor leads |
| `field_ret` | Field visits, biometric attendance, activity logging for Retailer leads |
| `tech_support` | View and resolve internal tickets raised by any team member |

Notes:
- Any account can hold any combination of capabilities (e.g. `dist_support` + `field_dist` + `ret_onboarding` all on one login).
- Manual Distributor↔Retailer mapping (on client request) is available to anyone holding `dist_support`, `dist_onboarding`, `ret_support`, or `ret_onboarding` — not a separate capability.
- `admin` overrides all restrictions.
- Only `admin` can add, remove, or change capabilities on any account.

### Data Model for Roles

```
users
  user_id (PK)
  name
  email (unique)
  password_hash
  is_active
  created_at

capabilities            -- fixed lookup table, seeded once, not user-editable
  code (PK)              -- e.g. 'dist_support'
  label

user_capabilities        -- many-to-many, this is what makes roles mixable
  id (PK)
  user_id (FK -> users)
  capability_code (FK -> capabilities)
  assigned_by (FK -> users, must be an admin)
  assigned_at
```

This structure is what makes reassignment instant: Admin adds/removes rows in `user_capabilities`. No schema change, no new account, no downtime.

---

## 2. Tech Stack

Chosen for a working system in 1 week with a small team (1–3 developers), minimal infrastructure to manage, and no separate backend server to build from scratch.

| Layer | Choice | Why |
|---|---|---|
| Frontend (web + mobile) | **Next.js (React) as a PWA** | One codebase for desktop dashboard and mobile field app; installable on phone home screen; no app-store approval needed |
| Backend | **Supabase** (Postgres + Auth + Storage + Realtime, hosted) | Gives database, authentication, file storage, and row-level security out of the box — removes the need to write a custom backend server |
| Database | **PostgreSQL** (via Supabase) | Relational structure fits the schema directly; supports Row Level Security for capability-based access |
| Authentication | **Supabase Auth** (email + password) | Built-in session handling; capabilities stored separately in `user_capabilities` and checked on every request |
| File storage (selfies) | **Supabase Storage** | Selfie images compressed client-side to ~200KB before upload |
| Access control | **Postgres Row Level Security (RLS) policies** | Each table has policies that check the requesting user's rows in `user_capabilities` — this is what enforces the role rules, not the frontend |
| Hosting | **Vercel** (frontend) | Deploys directly from a Git repository, free tier sufficient for a small team |
| Charts / KPI dashboard | **Recharts** (React charting library) | Lightweight, no extra backend needed, reads directly from Supabase queries |
| GPS + Camera capture | Native browser APIs: `navigator.geolocation`, `getUserMedia` | No third-party SDK required; works inside the PWA |
| Image compression | **browser-image-compression** (JS library) | Compresses selfie client-side before upload |

No mobile app store submission, no custom backend server, no DevOps pipeline needed for week one. This is deliberately the minimum stack that is still production-usable.

---

## 3. Core Tables (Final Schema)

```
leads
  lead_id (PK)
  business_name
  contact_person
  phone
  segment_type        -- 'Distributor' | 'Retailer'
  status               -- 'New','Contacted','Demo Scheduled','Negotiation','Converted','Lost'
  loss_reason
  assigned_to (FK -> users)
  created_at
  onboarded_at

client_queries          -- support mode, for existing/converted clients
  query_id (PK)
  lead_id (FK -> leads)
  raised_via            -- 'Call','Visit','Email'
  category
  status                -- 'Open','In Progress','Resolved'
  notes
  assigned_to (FK -> users)
  created_at
  resolved_at

mappings                -- manual distributor-retailer mapping on client request
  mapping_id (PK)
  distributor_lead_id (FK -> leads)
  retailer_lead_id (FK -> leads)
  requested_by           -- text: who asked for it (client side)
  mapped_by (FK -> users)
  notes
  created_at

internal_tickets         -- tech support queue, any team member can raise
  ticket_id (PK)
  raised_by (FK -> users)
  category               -- 'Access','Bug','Data','Other'
  priority                -- 'Low','Medium','High'
  status                  -- 'Open','In Progress','Resolved'
  description
  assigned_to (FK -> users, must hold tech_support)
  created_at
  resolved_at

attendance
  attendance_id (PK)
  user_id (FK -> users)
  date
  clock_in                -- server timestamp only
  clock_out
  selfie_url
  latitude
  longitude

call_logs
  log_id (PK)
  user_id (FK -> users)
  lead_id (FK -> leads)
  timestamp
  outcome
  notes
  next_followup_date
```

---

## 4. Access Rules (enforced via Postgres RLS, not just UI)

| Table | Rule |
|---|---|
| `leads` (segment_type = Distributor) | Visible/editable to users with `dist_onboarding` or `dist_support` |
| `leads` (segment_type = Retailer) | Visible/editable to users with `ret_onboarding` or `ret_support` |
| `client_queries` | Visible/editable to users with matching support capability for that lead's segment |
| `mappings` | Editable by anyone with any of the four sales/support capabilities |
| `internal_tickets` | Visible to `admin` and `tech_support`; a user can always view/create their own raised tickets |
| `attendance` | A user sees only their own records; `admin` sees all |
| all tables | `admin` capability bypasses every restriction |

Enforcing this at the database level (not just hiding buttons in the UI) means a capability change by Admin takes effect immediately and cannot be bypassed by calling the API directly.

---

## 5. Seven-Day Build Plan

### Day 1 — Infrastructure & Schema
- Create Supabase project, Postgres database
- Create all tables listed in Section 3, plus `capabilities` and `user_capabilities`
- Seed the 8 fixed capability rows
- Set up Next.js project, connect to Supabase, deploy a blank shell to Vercel

### Day 2 — Authentication & Admin Role Panel
- Implement login/logout with Supabase Auth
- Build Admin screen: list of users, checkboxes for each capability, save button writes to `user_capabilities`
- Write RLS policies for every table per Section 4
- Test: log in as a test account, confirm it only sees what its assigned capabilities allow

### Day 3 — Lead Pipeline (Onboarding Mode)
- Lead list + create/edit form, filtered by segment_type per user's capability
- Status pipeline: New → Contacted → Demo Scheduled → Negotiation → Converted/Lost
- Mandatory follow-up date/time when saving a note if status is not Converted/Lost
- Bulk CSV upload for leads (segment_type required column)
- Call/visit logging screen tied to `call_logs`

### Day 4 — Support Mode & Manual Mapping
- "Existing Clients" tab: list of Converted leads for the user's segment/capability
- Client query log screen tied to `client_queries` (create, update status, resolve)
- Manual mapping screen: search Distributor + Retailer, link them, store in `mappings`
- Toggle in the UI between "New Client Pipeline" and "Existing Client Queries" for dual-role users

### Day 5 — Attendance & Internal Ticketing
- Clock in/out button: trigger camera (`getUserMedia`), capture live photo only (no file picker), capture GPS
- Compress image client-side, upload to Supabase Storage, write row to `attendance` with server timestamp
- Internal ticket form (any user can raise), ticket queue view for `tech_support` capability holders
- Kanban-style status board for tickets: Open → In Progress → Resolved

### Day 6 — Admin KPI Dashboard
- Leaderboard: calls made, visits logged, leads converted, queries resolved — per user, filterable Daily/Weekly/Monthly
- Attendance compliance view: who checked in today, with map pins from lat/long
- Conversion metrics: Lead-to-Demo rate, Demo-to-Onboarded rate, Overall conversion rate
- Ticket SLA view: open tickets by age and priority

### Day 7 — Testing, Fixes, Go-Live
- Test each capability combination end-to-end (single-role and mixed-role accounts)
- Confirm RLS blocks cross-segment access (a Retailer-only account cannot see Distributor leads)
- Fix bugs found during testing
- Create real user accounts, assign initial capabilities
- Short walkthrough session with the team, go live

---

## 6. What Is Deliberately Left Out of Week One

To make the 1-week deadline realistic, these are excluded from the first release and can be added after:

- Offline sync for field logging in low-network areas
- Automated SLA escalation/alerts on tickets or queries
- Data export/reporting beyond the dashboard views
- Native mobile app (PWA covers this for week one)

These do not block daily use of the system and can be added in a second pass without changing the schema built in Week One.
