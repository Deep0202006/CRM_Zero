# CRM Zero

CRM Zero is a modern Customer Relationship Management (CRM) platform built with Next.js, Supabase, and Tailwind CSS. It features a robust role-based access control (RBAC) system, secure authentication, and administrative dashboards for managing enterprise workflows.

## 🚀 Tech Stack

- **Frontend:** Next.js (App Router), React, Tailwind CSS, Lucide React (Icons)
- **Backend/Database:** Supabase (PostgreSQL), Supabase Auth
- **Validation:** Zod
- **Deployment:** Vercel

## 🏗️ System Architecture & Context

CRM Zero uses Supabase as its core backend. Authentication is handled natively by Supabase Auth, while user metadata, roles, and profiles are stored in custom PostgreSQL tables. 

### Data Models
- **`users` Table:** Stores business logic user profiles (name, email, manager associations, active status).
- **`user_capabilities` Table:** Stores the specific roles and permissions assigned to a user.
- **Supabase Auth:** Manages JWTs, passwords, and sessions internally.

### Role-Based Access Control (RBAC)
The application defines several strict capabilities that restrict access to various panels:
- `admin`: Full system access, capable of creating users, resetting passwords, and modifying the capability matrix.
- `dist_onboarding`: Distributor Onboarding workflows.
- `dist_support`: Distributor Support.
- `ret_onboarding`: Retailer Onboarding workflows.
- `ret_support`: Retailer Support workflows.
- `field_dist`: Field operations for distributors.
- `field_ret`: Field operations for retailers.
- `tech_support`: Technical Support access.

## 🔄 Core Workflows

### 1. Authentication & Session Management
- Users log in via `/login` using their email and password.
- The `AuthContext` (`src/context/AuthContext.tsx`) manages global session state. Upon a successful login, it fetches the user's assigned capabilities and stores them in context to dynamically render allowed sidebar links and protect routes.
- Logout is handled securely by invalidating the Supabase session token via `supabase.auth.signOut()` and clearing local storage.

### 2. Admin: User Creation
- The Admin dashboard (`/admin`) provides a comprehensive "Capability Matrix".
- Admins can seamlessly create new users. The workflow involves:
  1. Validating input via Zod (ensuring names, valid emails, and at least one capability is selected).
  2. Generating a secure random password if the admin does not manually specify one.
  3. Bypassing Row Level Security (RLS) using the server-side `supabaseAdmin` client (powered by the Service Role Key).
  4. Generating a Supabase Auth identity.
  5. Automatically creating corresponding records in the `users` and `user_capabilities` tables to link the Auth ID with business logic.

### 3. Admin: Password Management & Overrides
- Admins have the authority to forcefully reset or update passwords for any user in the system to recover locked accounts.
- **Workflow:**
  1. Admin selects a user and inputs a new password (min. 6 characters) or generates one.
  2. The frontend POSTs to the `/api/admin/reset-password` endpoint.
  3. The endpoint verifies the caller is an active admin using their session token.
  4. The endpoint utilizes `supabaseAdmin.auth.admin.updateUserById` to forcibly update the user's credentials in Supabase Auth.
- *Note:* Regular users cannot change others' passwords. Password resets are an admin-only privilege.

## 🛠️ Environment Variables & Deployment

To run CRM Zero locally or on Vercel, the following environment variables MUST be configured:

```env
# Required for standard client-side authentication and database querying
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>

# CRITICAL: Required for Admin workflows (User Creation, Password Reset)
# This key bypasses Row Level Security (RLS) and should NEVER be exposed to the client.
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

### Vercel Deployment Rules
When deploying to Vercel, ensure that **all three** environment variables are populated in the Vercel Project Settings. 
*Failure to include the `SUPABASE_SERVICE_ROLE_KEY` will result in `500 Server Configuration Error` or `401 Invalid session` during Admin operations, as the server will lack the authorization to manage Supabase users.*

## 🐛 Troubleshooting & Known Patterns

1. **Admin Actions Failing (Invalid Session / 500 Error):** 
   If admin actions like creating users or resetting passwords fail on Vercel but work locally, it means the `SUPABASE_SERVICE_ROLE_KEY` is missing in Vercel's environment variables. 
2. **Password Minimum Length:** 
   Supabase enforces a strict 6-character minimum for passwords. The Next.js API uses Zod to validate this before sending the request to Supabase to prevent unhandled API crashes.
3. **Stale Sessions:**
   When developing auth flows, always ensure `supabase.auth.signOut()` is explicitly awaited during logout to prevent the browser from holding onto stale JWTs.
