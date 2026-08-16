# Execution Plan: PR #50 Vercel production font-build recovery

## Goal

Certify owner-044 independently, identify the evidence-backed cause of the production-only `next/font/google` Turbopack failure, and release the smallest build-only hotfix through a clean PR and exact-SHA production verification.

## Non-goals

- Do not revert PR #50 or change Field Visit, Mapping, Pipeline, or other business behavior.
- Do not create or apply a migration, rerun owner-044, create production fixtures, or manually redeploy.
- Do not redesign typography or upgrade the framework unless direct evidence proves it necessary.

## Current state

- PR #50 merged as `29d7b0a5ca1f31ed495abd8ec27abc648f586724`.
- Its production deployment `dpl_GcHpNeyVPuChzq1eet6JoryqH1Tn` failed during the Turbopack `next/font/google` build path before runtime/database access.
- The prior production deployment remains live.

## Invariants

- owner-044 certification and the Vercel build incident are separate tracks; the build failure is not attributed to Supabase.
- Business logic, UI structure, data authority, and production data remain unchanged.
- Production smoke verification is read-only.
- The release follows branch → verification → PR → preview → merge → exact-main production READY verification.

## Affected domains

- Release/build tooling and the application font bootstrap only.

## Implementation steps

1. Certify owner-044 purity, additive behavior, row-preservation, and compatibility with the old live frontend.
2. Capture the successful preview and failed production build inputs: SHA, dependency lock, Node/Next versions, scripts, configuration, logs, cache/build metadata, and font import path.
3. Choose the smallest evidence-backed correction and preserve Inter appearance.
4. Run the exact Vercel build script plus full R3 gates and affected feature regressions.
5. Open a focused hotfix PR, obtain exact-head CI and READY Preview, then merge without force-push.
6. Verify the exact new main SHA has a READY production deployment and perform read-only feature smoke checks.

## Verification

- SQL static certification and owner/migration artifact parity.
- `npm run vercel-build`, Jest, typecheck, lint, build, harness, focused Field Visit and Mapping tests.
- Exact-head GitHub CI, Vercel Preview READY, production deployment READY at merged main SHA.

## Production safety

- [x] Production mutation is not authorized and is not required.
- [x] Schema/RLS mutation is outside this hotfix; owner-044 remains owner-operated.
- [ ] Read-only production audit completed where production state matters.
- [x] Secrets and production connections are excluded from CI/local tests.

## Rollback

Revert only the hotfix commit if it causes a regression. Do not revert PR #50 and do not alter schema/data as rollback.

## Decision log

- 2026-08-16: Classified R3 because this is a P0 production release recovery, despite the intended code diff being build-only.
- 2026-08-16: Preview `dpl_9wnCRZ48rGgS2tmXqUmwiGAwSJCY` and failed production `dpl_GcHpNeyVPuChzq1eet6JoryqH1Tn` used the same Git tree, lockfile, Next 16.2.9, Vercel CLI 58.1.0, Node 24.x project setting, region, build command, and restored cache source. Production alone received HTTP 404 for generated Inter v20 assets before Turbopack internal-font resolution failed.
- 2026-08-16: A cache-only retry was rejected as non-durable. Replaced `next/font/google` with installed-Next-supported `next/font/local`, using the official Inter 4.1 variable WOFF2 (SHA-256 `693B77D4F32EE9B8BFC995589B5FAD5E99ADF2832738661F5402F9978429A8E3`) while retaining `--font-inter`, `display: swap`, and the Inter weight range.

## Progress

- [x] Incident contract and scope frozen.
- [x] owner-044 certified.
- [x] Root cause proven.
- [x] Minimal hotfix passes the exact `npm run vercel-build` path.
- [ ] PR/Preview/CI complete.
- [ ] Production exact-SHA verification complete.
