# Engineering OS V6A

## Outcome

The Owner states a requirement once. `crm:task` creates one durable task and binds
its exact branch, worktree, base, head, tree and current index. Navigation evidence
permits broad read-only investigation; it never grants write authority.

## Canonical task continuity

`.git/zd-os/tasks/<task-id>/` is the sole authority for task identity, objective,
acceptance, scope, blockers, proof and delivery. Session files contain only
transport/runtime state and one `boundTaskId`. SessionStart and UserPromptSubmit
invoke the same lock-bounded `resolveOrBindSessionTask` transition. A valid binding
is verified and reused; otherwise exactly one compatible unfinished durable task
is atomically bound. Compatibility requires the same canonical common Git
directory, full branch identity and normalized literal worktree, with the recorded
HEAD equal to or an ancestor of local HEAD. Tracked or untracked interruption is
not a resume failure and recovery never cleans, resets, stashes, moves, copies or
discloses it. Multiple matches fail `SESSION_BINDING_AMBIGUOUS`; corrupt discovery
fails `TASK_DISCOVERY_CORRUPT`; terminal or released tasks are never rebound.

With zero matches, the canonical bootstrap workspace enters `AWAITING_TASK`.
A registered linked `feat/`, `fix/` or `chore/` worktree instead enters
`RECOVERY_REQUIRED` and advertises the task-ID-free `RESUME_CURRENT_WORKSPACE`
action. The action may adopt that branch, worktree and exactly identified open PR
in place only when registration, topology, claims and non-divergent ancestry are
safe. It creates no branch, worktree or PR and rewrites no history. A local HEAD
ahead of the PR head is valid. UserPromptSubmit, PreToolUse, PostToolUse and Stop
use the same ID and fail closed on repository, branch, worktree or history mismatch.

Status questions and exact continuation phrases are non-amending. Every prompt
records only a monotonic sequence, disposition, byte count and SHA-256 in session
state. An ordinary requirement evolves acceptance and plan in the bound task,
moves current proof to history, clears current proof and delivery, and returns the
task to investigation. Stop cannot certify it until scope and proof are current.
A new task requires `NEW_TASK: <requirement>` or exact
`npm run crm:task -- --task "<requirement>"`; the operation creates a collision-safe
task and binds the initiating session without Owner-supplied internal IDs. Prompt-
time status, resume and continuation first recover the binding and never amend the
task. An unbound `KERNEL_CONTINUE|taskId=...` binds that exact compatible,
nonterminal task before continuation validation. `NEW_TASK` returns
`NEW_TASK_ACTIVE_TASK_EXISTS` whenever an unfinished task exists, regardless of
requirement text, and never creates a duplicate.

New-task suitability is separate from existing-task recovery and reports the
specific sanitized reason: `BRANCH_UNSUITABLE`, `PRIMARY_WORKTREE_UNSUITABLE`,
`WORKTREE_NOT_REGISTERED`, `WORKTREE_LOCATION_UNSUITABLE`,
`WORKTREE_DIRTY_FOR_NEW_TASK`, `ACTIVE_TASK_EXISTS`, `TASK_BRANCH_MISMATCH`,
`TASK_WORKTREE_MISMATCH`, `TASK_HISTORY_DIVERGED` or
`TASK_RECOVERY_AMBIGUOUS`. Existing-task recovery never applies the new-task
cleanliness rule.

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

Binding and rebinding are operational session metadata: they do not increment task
or requirements revision, amend acceptance, invalidate proof, alter delivery or
drift release approval. Creation while holding the session lock re-reads discovery
and identity; a failed session write rolls back only the task created by that
operation, so retry is idempotent and cannot expose an unbound duplicate. Stop
returns one actionable `RECOVERY_REQUIRED:RESUME_CURRENT_WORKSPACE` result for an
orphaned linked workspace and does not increment the stall counter or emit an
endless `KERNEL_CONTINUE` loop.

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
the child-process suite also executes their portable Windows commands through the
exact `cmd.exe /D /S /C` transport. The receipt records sanitized paths, hashes,
event types, exit status and repository/task/session identities, never prompt
prose, credentials, environment dumps or secrets.

Codex CLI is the supported Engineering OS execution host. The final enabled-hook
canary on Codex CLI 0.153.2 completed fresh and resumed turns but did not invoke
the repository hook commands or persist a session record. Therefore the five
project hook registrations are intentionally absent from `.codex/hooks.json`.
The controllers remain available as explicit commands and the five entrypoints,
Windows transport, continuity state machine, proof, readiness and release gates
remain executable CI/readiness controls. This availability fallback is permanent:
repository hooks are non-blocking and no further hook redesign cycle is required.
Global/user Ponytail configuration is not modified. Codex Desktop remains outside
the supported execution contract and non-blocking.

## Completion

Completion requires independent current evidence for every acceptance item, a
clean commit, exact PR head/base, all six protected jobs, and an exact-head
Git-triggered READY Vercel Preview with smoke and task acceptance.
