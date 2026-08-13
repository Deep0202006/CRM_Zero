<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ZeroData Engineering Map

This file is the compact entry point. Load only the documents relevant to the task.

## System of record

- Start at [docs/os/INDEX.md](docs/os/INDEX.md).
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the current high-level shape.
- Follow links into [docs/architecture/](docs/architecture/) only for affected boundaries.
- Read only affected domain contracts in [docs/contracts/](docs/contracts/).
- Protect [Golden Principles](docs/quality/GOLDEN_PRINCIPLES.md) on every change.
- Classify with [Risk Model](docs/os/RISK_MODEL.md).
- Execute through [Change Protocol](docs/os/CHANGE_PROTOCOL.md).
- Ship through [Release Protocol](docs/os/RELEASE_PROTOCOL.md).

Implementation and tests are authoritative when documentation conflicts. Correct stale docs in the same task.

## Operating loop

### SCAN

- Confirm repository, branch, SHA, and worktree state.
- Preserve unrelated user changes.
- Read the root map, task manifest, affected contracts, relevant code, and tests.
- For Next.js changes, read the relevant installed Next.js guide first.

### CLASSIFY

- Create `.harness/task.json` before implementation; never commit it.
- Declare risk, domains, allowed paths, protected domains, data/schema effects, and acceptance.
- Risk may escalate automatically. Never silently downgrade it.

### PLAN

- R0/R1: keep the plan proportional.
- Large R2: use an execution plan when coordination or rollback is non-trivial.
- R3: create an active plan from `docs/exec-plans/TEMPLATE.md` before changing code.
- State non-goals and invariants before implementation.

### CHANGE

- Stay inside manifest paths and affected domains.
- Keep stable business IDs across retries.
- Preserve unknown records; do not guess or fabricate.
- Never mutate production data during local verification.
- Do not change schema, RLS, auth, or API contracts without explicit scope and R3 controls.

### VERIFY

- Run `npm run harness:verify`; risk selects the required gates.
- Use `npm run harness:related` for focused tests during development.
- Run full required gates before handoff.
- Treat failures as evidence; do not weaken tests or guards to obtain green output.

### REVIEW

- Review the diff for scope, invariants, authority boundaries, recovery, and rollback.
- Confirm executable guards avoid comments/docs false positives.
- Confirm no healthy product behavior changed unintentionally.

### RELEASE

- R2/R3 default: feature branch → verification → PR → Vercel preview → merge → production.
- Never push directly to `main` or force-push.
- Do not contact production Supabase from CI.
- Use the emergency hotfix exception only as documented.

### LEARN

- A repeated production defect must consider a contract update, invariant guard, regression test, and incident note.
- Do not require incident notes for trivial bugs.
- Move completed execution plans to `docs/exec-plans/completed/`.

## Non-negotiable safety

- No deletion of `call_logs` or `field_visits`.
- No clearing browser databases or durable recovery state.
- No fabricated production records.
- No service-role secrets in browser/client code.
- Critical calls and field visits use approved server confirmation APIs.
- Evidence failure cannot undo or block a confirmed field visit.
- India business dates use the shared IST helpers.
- Employee ownership is explicit; admin reporting is server-authoritative.

## Capability Reuse & Verification

- **Reuse Existing Capabilities:** Before implementing a feature that needs an existing domain capability, you MUST locate and reuse the existing working implementation rather than independently recreating it.
  - Employee selection → reuse canonical employee authority
  - Authentication → reuse canonical auth context
  - Admin authorization → reuse canonical authorization
  - Distributor identity → reuse distributor authority
  - Renewal → reuse `distributor_accounts.renewal_date`
  - Financial data → never duplicate receivables authority
- **End-to-End Verification:** A successful database migration does not prove a feature works. Database schema, API, authorization, frontend state, and E2E behavior must all be verified.
- **UI Bug Diagnosis:** Never prescribe a database migration solely because a UI feature is empty or broken. First determine whether the authoritative table exists and whether the application can read/write it.

## Progressive disclosure

For each task read, in order:

1. this file;
2. `.harness/task.json` risk and scope;
3. affected domain contract(s);
4. a relevant repository skill, if applicable;
5. relevant implementation and tests.

Do not preload every contract, historical repair folder, or migration.

## Scoped instructions

More specific instructions exist in:

- `src/app/api/AGENTS.md`
- `src/lib/callLogs/AGENTS.md`
- `src/lib/fieldVisits/AGENTS.md`
- `supabase/AGENTS.md`

## Useful commands

- `npm run harness:preflight`
- `npm run harness:scope`
- `npm run harness:guard`
- `npm run harness:docs`
- `npm run harness:related`
- `npm run harness:verify`
- `npm run harness:full`

Runtime harness files under `.harness/` are ignored except `.gitkeep`.
