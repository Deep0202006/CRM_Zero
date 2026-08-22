# Engineering workflow

## Discover

Inspect current main/worktree, make a Graphify query, select the affected domain
entry and exact contracts, then identify existing code to reuse.

## Lock

Record in the PR draft: outcome, expected user flow, canonical authority,
must-not-change, and risk. R0 is docs/presentation; R1 isolated non-critical
behavior; R2 business logic/API/critical read/sync; R3 schema, RLS, auth,
destructive, production, or foundational persistence.

## Implement and verify

Use one clean worktree and one direct Codex implementation. Apply Ponytail FULL
and run focused tests first. R0 needs lightweight relevant proof; R1 focused
tests plus typecheck/lint; R2 focused/full unit plus typecheck/lint/build; R3
adds disposable PostgreSQL, security/isolation, and E2E where applicable.
GitHub CI is final repository proof.

## Schema release

Run PR CI/preview first. The Owner reviews and manually applies SQL, then runs
a read-only postcheck. The migration becomes immutable; every repair is forward
only. Do not create durable task state files. Use a PR body or temporary
uncommitted brief for complex work unless a design document is explicitly
requested.
