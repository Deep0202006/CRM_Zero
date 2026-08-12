# Execution Plan: CTO cost and egress hardening

## Goal

Evidence, rank, and safely reduce unnecessary Supabase requests, failed requests, and egress without changing business behavior or production data.

## Non-goals

- No production data writes, migrations, schema/RLS/auth-policy changes, or dummy records.
- No weakening realtime, cross-device, payment, or server-authoritative correctness.
- No deletion of refresh behavior without an evidenced replacement.

## Current state

Supabase reports roughly 58,004 requests in 24 hours, 76.3% success, thousands of PostgreSQL errors, and Fair Use grace. Database, storage, and MAU volumes are otherwise small. Root drivers are not yet evidenced.

## Invariants

- All Golden Principles remain intact.
- Confirmed server rows remain cross-device authority.
- Payment Collections remains authoritative and fresh after mutations/reconnect/focus.
- Hidden pages do not poll unless a correctness contract explicitly requires it.
- Retries are bounded and only retry transient failures.

## Affected domains

Auth/session, dashboards, My Day, pipeline, calls, field visits, Team KPI, Team Chat/realtime, receivables, storage/evidence, and shared Supabase request infrastructure.

## Implementation steps

1. Complete repository and production-log read-only forensics; quantify request/error drivers.
2. Form and verify specific root-cause hypotheses against code and logs.
3. Update this plan and manifest with the narrowest evidenced change paths.
4. Implement minimal fixes with regression tests and explicit before/after behavior.
5. Run focused and full R3 verification; review scope and invariants.
6. Release only through feature branch, PR, preview, merge, and production protocols; compare read-only post-deploy rates if deployment authority and evidence are available.

## Verification

- Focused regression tests for deduplication, visibility, retry bounds, and query bounds.
- `npm run harness:related`
- Appropriate Playwright E2E against non-production fixtures/mocks.
- `npm run harness:verify` and full tests/typecheck/lint/build.
- Read-only Vercel/Supabase production log comparison after deployment.

## Production safety

- [x] Production mutation not authorized and not required
- [x] Schema/RLS impact not authorized and not planned
- [ ] Read-only audit completed where production state matters
- [x] Secrets and production connections excluded from CI/local tests

## Rollback

Revert the isolated application commit/deployment. No data rollback or migration rollback is expected because neither is permitted.

## Decision log

- 2026-08-12: Classified R3 because live Supabase, auth failures, authoritative reads, and production deployment are in scope.
- 2026-08-12: Enforced read-only production investigation before application changes.
- 2026-08-12: Vercel showed 971 call-confirmation requests (929 HTTP 500, 42 HTTP 400) in 24 hours; Supabase PostgreSQL logs showed 90/100 latest entries violating `call_logs_client_reference_check`.
- 2026-08-12: Read-only catalog inspection confirmed the deployed constraint requires a lead ID or both client username and name. No production rows were read or changed.
- 2026-08-12: Recent API logs showed repeated 20-table `select=*` hydration passes, including three 1,000-row call-log pages. Kept the fallback but serialized it and changed its minimum interval from 5 to 30 minutes per authenticated browser account.

## Progress

- [x] Repository/branch/SHA/worktree scanned; unrelated user artifacts identified for preservation.
- [x] Read-only request/error forensics complete.
- [x] Root causes verified.
- [x] Fixes implemented; focused tests and typecheck pass.
- [ ] Released and post-deploy comparison complete.
