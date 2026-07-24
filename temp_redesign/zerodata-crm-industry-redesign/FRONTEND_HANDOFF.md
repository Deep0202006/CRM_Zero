# FRONTEND HANDOFF — ZERODATA CRM REDESIGN

## Project

- Framework: Next.js 16.2.9 App Router
- React: 19.2.4
- TypeScript: 5.x
- Styling: Tailwind CSS v4 plus centralized CSS variables
- Package manager: npm
- Frontend root: project root

## Commands

```bash
npm ci
npm run dev
npm run lint
npm test
npm run build
npm start
```

- Development URL: `http://localhost:3000`
- Login route: `http://localhost:3000/login`

## UI routes

1. `/`
2. `/login`
3. `/my-day`
4. `/onboarding`
5. `/mappings`
6. `/support`
7. `/call-logs`
8. `/attendance`
9. `/admin`
10. `/admin/attendance`
11. `/manager/kpi`
12. `/manager/tasks`

## API routes retained

- `/api/admin/create-user`
- `/api/admin/reset-password`
- `/api/admin/update-user`
- `/api/task-upload`

## Key frontend locations

- Design tokens: `src/design-system/tokens.css`
- Global styles and animations: `src/app/globals.css`
- Application shell: `src/components/DashboardLayout.tsx`
- Login experience: `src/app/login/page.tsx`
- Shared UI: `src/components/ui/`
- Command palette: `src/components/CommandPalette.tsx`
- Record inspector: `src/components/RecordInspector.tsx`
- Authentication: `src/context/AuthContext.tsx`
- Supabase client: `src/lib/supabaseClient.ts`
- Dexie and sync: `src/lib/db.ts`

## Libraries

- Lucide React: icons
- Recharts: analytics
- Dexie: local persistence/offline queue
- Supabase: authentication and backend
- Zod: validation
- XLSX: spreadsheet workflows

## Verification status

Static source validation passed. A production build is **not claimed** in the handoff environment because `node_modules` was absent and the npm registry was unreachable. Run the commands in `docs/frontend-redesign/QA_AND_RUNBOOK.md` locally before deployment.

## Exclusions

The final archive excludes `.git`, `.agents`, `node_modules`, `.next`, build outputs, caches, real `.env` files and secrets. `.env.example` may be included when present. The unrelated `scripts/seed-production-users.js` file is excluded because the original repository contains a literal seed password in that script.
