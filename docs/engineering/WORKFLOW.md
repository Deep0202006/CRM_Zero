# Engineering workflow

## Task and resolve

Resolve natural-language intent first, inspect current main/worktree, use
targeted `rg`/`git grep`/path search, open the exact current source, then select the affected
contracts, authority, and reusable implementation. Use Graphify only when
relationships are ambiguous/cross-domain or it materially lowers search cost;
then run `graphify:sync`, make one bounded query, and open the result. Graphify
is a locator, never authority, and unavailable Graphify never blocks ordinary
product work.

## Implement and impact

Lock outcome, canonical authority, must-not-write facts and minimum change.
Compile the actual diff after implementation; requested risk never overrides
detected effects. R0 is docs/presentation; R1 isolated non-critical
behavior; R2 business logic/API/critical read/sync; R3 schema, RLS, auth,
destructive, production, or foundational persistence.

## Prove and certify

Use `proof:plan` and `verify:affected`; declared business proofs remain required
alongside related tests. R3 adds GitHub-hosted disposable PostgreSQL,
security/isolation, E2E, and Owner SQL evidence where applicable. A retry-pass
is `FLAKY_DETECTED`, not release PASS. GitHub exact-head CI is final repository
proof; generated or refreshed tests never rewrite correctness expectations.

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

## Learn

Run `learn:close` for R2/R3 failures. Known rules strengthen their enforcement
or eval; genuinely reusable unrepresented gaps add claim, enforcement and
Golden evidence. Non-reusable mistakes do not create registry churn.

`task:close` binds the task baseline, current impact, proof plan, proof evidence,
and learning outcome. It returns local completion, remote-evidence waiting, a
typed external/safety gate, or exact-head certification; it never accepts WIP as
success. Low-confidence, close-margin, cross-domain tasks may use bounded
Graphify navigation, whose sanitized outcome can only improve path ranking.
