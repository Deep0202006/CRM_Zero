# Engineering OS V6A

## Outcome

The Owner states a requirement once. `crm:task` creates one durable task and binds
its exact branch, worktree, base, head, tree and current index. Navigation evidence
permits broad read-only investigation; it never grants write authority.

## Canonical task continuity

`.git/zd-os/tasks/<task-id>/` is the sole authority for task identity, objective,
acceptance, scope, blockers, proof and delivery. Session files contain only
transport/runtime state and one `boundTaskId`. SessionStart binds exactly one
compatible unfinished durable task. With zero matches it enters `AWAITING_TASK`,
permits read-only inspection plus exact task bootstrap, and denies other mutation;
multiple matches fail as ambiguous. Terminal or released tasks are unbound.
UserPromptSubmit, PreToolUse, PostToolUse and Stop use the same ID and fail closed
on branch or worktree mismatch.

Status questions and exact continuation phrases are non-amending. Every prompt
records only a monotonic sequence, disposition, byte count and SHA-256 in session
state. An ordinary requirement evolves acceptance and plan in the bound task,
moves current proof to history, clears current proof and delivery, and returns the
task to investigation. Stop cannot certify it until scope and proof are current.
A new task requires `NEW_TASK: <requirement>` or exact
`npm run crm:task -- --task "<requirement>"`; the operation creates a collision-safe
task and binds the initiating session without Owner-supplied internal IDs.

## Before the first edit

Persist observable acceptance, non-goals, reproduction, root cause, affected
authority, reused capability, current-hash-bound write scope, protected paths,
risk and focused proof. Deterministic callers, readers, routes, RPCs, contracts,
compiler errors and related tests may expand scope without interrupting the
Owner. Genuine business ambiguity and production operations require the Owner.

## State and proof

Task state uses a task-wide compare-and-swap revision, same-directory atomic
rename, append-only progress and metadata-bearing locks with bounded backoff.
A lock is recovered only when it is old and its recorded process is dead. Every
accepted state change regenerates one revision-bound snapshot and deterministic
handoff. Corrupt task/session state remains in place and is reported by bounded
hash, never renamed or silently treated as zero tasks. Proof remains process/CI-
derived, requirement-revision-bound and exact-head-bound. A retry-pass is
`FLAKY_DETECTED`.

Automatic hook context contains metadata only: task/repository identity, counts,
status codes, amendment hashes and invalidated proof IDs. It never injects
objective, acceptance, failure, customer or secret prose. If the capsule exceeds
its byte budget, it emits a compact pointer containing path, task, revision, byte
count and SHA-256; mutation remains blocked until
`npm run crm:session:reread` verifies and acknowledges those exact bytes. Required
state is never truncated.

`handoff.md` is generated from structured task state and cannot be caller-authored.
Task creation/amendment, acceptance or scope writes, progress/failure, proof,
head and delivery changes regenerate it. `crm:session:status` and
`crm:session:snapshot` are read-only diagnostics and never repair, migrate or
rename state.

Legacy V1 session task IDs are untrusted. Migration preserves the original file
and binds only when exactly one unfinished durable task matches branch and
worktree; zero enters `AWAITING_TASK` and multiple matches fail closed.

Package installation is denied by default. The only prospective exception is one
exact-semver package declared by the prepared R3 plan, with current hashes for
`package.json` and `package-lock.json`, using exactly `npm install --save-exact
--ignore-scripts --registry=https://registry.npmjs.org <name>@<version>`. Tags,
ranges, URLs, alternate registries and unregistered packages remain denied.

Continuity regression proof executes the real SessionStart, UserPromptSubmit,
PreToolUse, PostToolUse and Stop scripts as JSON child processes in a temporary
managed Git worktree. Direct function tests alone are not lifecycle evidence;
supported-host acceptance additionally requires a genuinely fresh Codex CLI
session to load SessionStart and persist its canonical session record, plus actual
CLI PreToolUse and PostToolUse integration. The receipt records sanitized paths,
hashes, event types, exit status and repository/task/session identities, never
prompt prose, credentials, environment dumps or secrets.

Codex CLI is the supported and required Engineering OS execution host. On Windows,
Codex CLI 0.153.2 launches the portable `commandWindows` definitions through
`cmd.exe`; acceptance therefore requires that exact transport behavior as well as
the registered child-process proof of all five lifecycle entrypoints. Codex
Desktop is currently unverified, outside the supported execution contract and
non-blocking. No Desktop lifecycle acceptance or certification is claimed.

## Completion

Completion requires independent current evidence for every acceptance item, a
clean commit, exact PR head/base, all six protected jobs, and an exact-head
Git-triggered READY Vercel Preview with smoke and task acceptance.
