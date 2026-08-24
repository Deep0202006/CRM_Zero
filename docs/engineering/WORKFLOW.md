# Engineering workflow

## Discover

Inspect current main/worktree, use targeted `rg`/`git grep`/path search, open
the exact current source, resolve task-aware context, then select the affected
contracts, authority, and reusable implementation. Use Graphify only when
relationships are ambiguous/cross-domain or it materially lowers search cost;
then run `graphify:sync`, make one bounded query, and open the result. Graphify
is a locator, never authority, and unavailable Graphify never blocks ordinary
product work.

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

Release blockers are real evidence failures: unresolved authority, a
security/auth leak, data-loss risk, relevant contract/implementation drift,
an unsatisfied schema/production gate, relevant failing tests/CI, or a
Graphify/source contradiction when Graphify was used. Do not invent process
blockers. A fully authority-safe runtime fix proven by relevant tests and CI is
not blocked solely to expand optional lesson metadata. Prevent recurring bugs
in order: shared implementation, validation/invariant, regression test, then a
durable lesson only when cross-cutting judgment cannot be mechanically enforced.

## Schema release

Run PR CI/preview first. The Owner reviews and manually applies SQL, then runs
a read-only postcheck. The migration becomes immutable; every repair is forward
only. Do not create durable task state files. Use a PR body or temporary
uncommitted brief for complex work unless a design document is explicitly
requested.
