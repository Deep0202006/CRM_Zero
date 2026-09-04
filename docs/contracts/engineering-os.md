# Engineering OS V6A

## Outcome

The Owner states a requirement once. `crm:task` creates one durable task and binds
its exact branch, worktree, base, head, tree and current index. Navigation evidence
permits broad read-only investigation; it never grants write authority.

## Canonical task continuity

`.git/zd-os/tasks/<task-id>/` is the sole authority for task identity, objective,
acceptance, scope, blockers, proof and delivery. Session files contain only
transport/runtime state and one `boundTaskId`. SessionStart binds exactly one
compatible unfinished durable task; UserPromptSubmit, PreToolUse, PostToolUse and
Stop must use that same ID and fail closed on branch or worktree mismatch.

An ordinary prompt appends a durable `TASK_AMENDED` requirement to the bound task,
preserving prior acceptance and proof history. It never creates a task. An
amendment returns the task to investigation and Stop cannot certify it until its
acceptance and write scope are prepared again. The sole new-task action is an
explicit `npm run crm:task -- --task "<requirement>"` invocation.

## Before the first edit

Persist observable acceptance, non-goals, reproduction, root cause, affected
authority, reused capability, current-hash-bound write scope, protected paths,
risk and focused proof. Deterministic callers, readers, routes, RPCs, contracts,
compiler errors and related tests may expand scope without interrupting the
Owner. Genuine business ambiguity and production operations require the Owner.

## State and proof

Task state uses bounded locking, same-directory atomic rename, compare-and-swap
revision and append-only progress. It stores references and bounded excerpts,
never secrets, customer records or full source. Proof remains process/CI-derived
and exact-head-bound. A retry-pass is `FLAKY_DETECTED`.

Session context is one structured durable-task snapshot. It includes task and
repository identity, acceptance state, non-goals, authorities, write scope,
protected paths, risk, blockers, proof summary, delivery, next action and resume
pointer. The serializer must fail closed rather than silently truncate required
state. Amendment text stays in durable progress; snapshots expose only its hash
and exact progress pointer.

`handoff.md` is generated from structured task state and cannot be caller-authored.
Task creation/amendment, acceptance or scope writes, progress/failure, proof,
head and delivery changes regenerate it. `crm:session:status` and
`crm:session:snapshot` are read-only diagnostics and never repair, migrate or
rename state.

Legacy V1 session task IDs are untrusted. Migration preserves the original file
and binds only when exactly one unfinished durable task matches branch and
worktree; zero or multiple matches fail closed.

## Completion

Completion requires independent current evidence for every acceptance item, a
clean commit, exact PR head/base, all six protected jobs, and an exact-head
Git-triggered READY Vercel Preview with smoke and task acceptance.
