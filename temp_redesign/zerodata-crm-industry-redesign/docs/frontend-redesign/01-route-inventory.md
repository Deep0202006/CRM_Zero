# 01 Route Inventory: CRM Zero Operational Intelligence Workspace

This document defines every active authenticated CRM route, its business capability requirements, responsive design contract, and target layout.

| Route | Primary Purpose | Required Role / Capability | Target Workspace Composition | Key Operational Actions |
| :--- | :--- | :--- | :--- | :--- |
| `/` | Operational Intelligence Overview | Admin / All Authenticated | Full-Width Editorial Grid (8/4 split) | Attention Queue triage, Activity stream inspection |
| `/my-day` | Daily Task & Field Targets Execution | Field Staff / All Users | Action Queue + Single Completion Card | Single "Done" action, Field target completion |
| `/onboarding` | Lead Pipeline Workspace | Onboarding Staff / Admin | Dual-View Kanban & Density Table | Stage movement, Gate note validation, Lead export |
| `/mappings` | Distributor-Retailer Mappings | Support Staff / Admin | Split Form (2-col) & Queue List (3-col) | 1:1 and 1:N mapping logging, Completion toggle |
| `/support` | Client Query Desk | Support Staff / Admin | Query Queue & Quick Resolve Modal | Fast resolution notes, SLA tracking |
| `/call-logs` | Manual Call History | All Authenticated | Log Form & Searchable Audit Stream | Call outcome logging, Excel export |
| `/attendance` | Biometric & Location Punching | Field Staff / Office Staff | Split Verification Panel & Log | Check-in / Check-out, Location verification |
| `/admin` | User & Role Management Console | System Admin Only | Full-Width Table & User Edit Drawer | Capability toggling, Password reset, User creation |
| `/admin/attendance` | Team Attendance Log | System Admin Only | Date-Filtered Full Table | Attendance report export, Filter by user/date |
| `/manager/kpi` | Performance Analytics Desk | Admin / Team Managers | Recharts Data Visualization Desk | Performance metrics, Conversion funnels |
| `/manager/tasks` | Bulk Excel Task Assignment | Task Assigner / Admin | Direct Supabase RPC Upload Workspace | 15-column Excel parser, City batch allocation |
| `/login` | Biometric Authentication | Public / Unauthenticated | Single Dimensional Graphic & Auth Panel | Password login, Session initialization |
