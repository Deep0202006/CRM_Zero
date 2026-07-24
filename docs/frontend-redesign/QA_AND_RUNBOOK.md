# QA and Local Runbook

## 1. Install and verify

From the project root:

```bash
npm ci
npm run lint
npm test
npm run build
npm run dev
```

Open `http://localhost:3000/login`.

## 2. Required viewport review

Review every major route at:

- 1440 × 900
- 1280 × 800
- 1024 × 768
- 768 × 1024
- 390 × 844
- 360 × 800

## 3. Login acceptance

- Logo appears before the form.
- Intro is skippable.
- Intro does not loop indefinitely.
- Scroll story reveals without jank.
- Keyboard can reach the login form and controls.
- Password visibility button has an accessible name.
- Reduced-motion mode removes transform-heavy reveals and smooth scroll.
- No horizontal overflow occurs at 360px.

## 4. Shell acceptance

- Sidebar group visibility matches permissions.
- Collapse preference persists.
- `Ctrl/Cmd + K` opens route search.
- Escape closes command palette, mobile navigation, modals and record inspector.
- Focus remains trapped inside open modal surfaces and returns to the opener after close.
- Mobile drawer does not expose a collapsed icon-only state.
- Theme persists across refresh.
- Sync/offline feedback remains readable in both themes.

## 5. Route workflow checks

- `/my-day`: complete standard task; complete follow-up with required outcome; cancel; delete permitted task; verify denied delete state.
- `/onboarding`: create lead with segment/source; search/filter; open inspector; move stages through existing rules.
- `/call-logs`: save a call, search history, export.
- `/mappings`: create supported mappings and review queue states.
- `/support`: resolve and reopen supported query states.
- `/attendance`: verify office, field, confirmed and restricted presentations.
- `/admin`: create user, update capabilities, reset password and verify permission denial.
- `/admin/attendance`: filter and export.
- `/manager/tasks`: validate good/bad spreadsheets, map all cities, review allocation and submit.
- `/manager/kpi`: verify charts, table labels, empty data and responsive layouts.

## 6. Accessibility checks

- Complete primary workflows using keyboard only.
- Verify visible focus in both themes.
- Test browser zoom at 200%.
- Test `prefers-reduced-motion: reduce`.
- Verify modal/drawer focus restoration.
- Verify form labels, descriptions and error announcements.
- Verify status is not communicated by colour alone.

## 7. Data and security checks

- Use test credentials only.
- Confirm no `.env` secret file is present in the archive.
- Verify Supabase permission errors remain visible and actionable.
- Confirm Dexie sync queue behaviour works online and offline.
- Confirm no backend schema, RPC or permission contract changed.
