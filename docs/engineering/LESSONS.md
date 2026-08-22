# Durable engineering lessons

## One fact, one authority

Never create a second editable authority for an existing business fact.

## ERP

- `public.erp_systems` is canonical ERP identity.
- `distributor_accounts.erp_id` is the official Distributor ERP assignment.
- Field Visit ERP is an exact visit-time observation only.
- `field_business_erp_baselines` is Admin current-state enrichment only.
- Explicit `None` is distinct from `Not captured`.
- An Admin baseline must never rewrite historical visits.

## Finance

- Receivables plus effective confirmed, non-reversed payments are the money truth.
- A payment targets an exact `receivable_id`.
- Operational billed status is not an unpaid monetary obligation.

## Imports

- Validate a complete batch before mutation.
- Stable external keys, not fuzzy names, own synchronization identity.
- A blank existing-master import cell means no change unless an explicit clear token is supplied.
- Repeated payment imports require idempotency.

## Field and offline contracts

- Exact compatibility payloads stay exact.
- Extend or version new payloads instead of weakening an old fallback.
- Write success requires authoritative read closure.

## Database and API

- PostgreSQL numeric JSON may arrive in JavaScript as numbers; normalize it at the API boundary.
- Mocks must preserve production wire types.
- Time-sensitive tests freeze the business or system clock.

## Production

- Never create production dummy or test business data.
- Only the Owner manually applies reviewed production migration SQL.
- Post-migration verification is read-only.
- Applied migrations are immutable.
- Production secrets and service roles never enter browser code.

## Engineering

- Preserve unknown owner dirty work.
- Use a clean isolated worktree for changes.
- Exact-head CI evidence belongs only to that exact head.
- Use authoritative existing CI rather than downloading redundant infrastructure.
- Distinguish baseline failures from head regressions.

## Direct implementation

- Never wrap the primary coding agent in another autonomous coding-agent loop for routine feature development.
- Graphify is navigation and intelligence only.
- Ponytail is minimum-change discipline only.
- Codex is the single implementation agent.
- GitHub CI proves the code.
- The Owner controls production database mutation.

## Evidence

Changing files is not evidence of progress. Progress means a defined acceptance behavior became demonstrably correct.
