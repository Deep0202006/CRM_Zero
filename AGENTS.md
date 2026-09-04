<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

The installed Next.js version is authority. Before changing its APIs, routing,
caching, rendering, middleware, or conventions, read the relevant guide under
`node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

# ZeroData engineering kernel

Scope is `Deep0202006/CRM_Zero`. Preserve unknown work; use a clean feature
worktree; never reset, clean, force-push, or push directly to `main`.

Resolve intent with `npm run context:resolve -- --task "<outcome>"`. Open every
returned candidate and revalidate its content hash before editing. Ambiguous or
unknown scope permits inspection only. Current source and tests are behavior
evidence; contracts state invariants; AUTHORITIES owns facts; CAPABILITIES marks
required reuse; DOMAIN_MAP sets risk floors; PROOFS registers executable proof.
When `crm:task` returns a managed worktree in its task packet, perform all subsequent
task edits and proofs in that exact worktree.

The durable packet under `.git/zd-os/tasks/<task-id>/` is the only task authority.
Session state carries transport metadata plus one `boundTaskId`; every hook uses
that exact compatible unfinished task and fails closed on branch/worktree drift.
Zero matches means `AWAITING_TASK`: allow read-only inspection and exact bootstrap,
but no other mutation. Multiple matches are ambiguous. Terminal tasks unbind.
Status and continuation prompts do not amend. Requirement prompts evolve
acceptance/plan and invalidate current proof/delivery. `NEW_TASK: <requirement>`
or exact `npm run crm:task -- --task "<requirement>"` creates and binds a successor
without asking the Owner for internal IDs. Automatic hook context is metadata-only;
on a pointer capsule run `npm run crm:session:reread` before mutation. Use
`npm run crm:session:status` or `npm run crm:session:snapshot` for read-only
diagnostics; never hand-author `handoff.md` or suppress corrupt state.

After a change run `impact:compile`, `proof:plan`, and only registered proofs.
Unknown executable/config paths, control-plane changes, schema, RLS, auth,
money, platform, production, migrations, and workflows are R3. GitHub CI binds
the repository certificate to the exact PR head, contained base, manifest, plan,
and real command results. Reports and caller-authored evidence are never proof.

Graphify is an optional read-only structural locator. It grants no authority;
for every real resolution, merge one bounded fresh-graph query using the exact
task with deterministic source-index evidence, then revalidate returned paths
against current tracked source. When unavailable or stale, use targeted exact
source search. Graphify cannot grant write authority, reduce risk, or overrule
source, tests, contracts, or registries. Lessons and rules change only through
ordinary reviewed diffs.

For any new write, RPC, schema field, migration, or cross-domain authority,
inspect and trace first, create the smallest write-bearing skeleton or proposed
operation, and run `impact:compile` immediately. Resolve authority classification
before completing UI, readers, or broad tests. Impact is evidence, not task
self-certification.

After implementation and focused proof, use the installed Ponytail skill when
available for one final YAGNI/minimal-diff review. Ponytail is advisory: it
cannot change authority, remove acceptance, weaken tests, bypass safety, or
block completion for style preference. Its absence is not a proof failure and
it is not a CI dependency.

Classify failures as `INTERNAL_TASK_DEFECT`, `INTERNAL_KERNEL_DEFECT`,
`ENVIRONMENT_PARITY_DEFECT`, `EXTERNAL_DEPENDENCY`, `HUMAN_PRODUCTION_GATE`,
`SAFETY_CONFLICT`, `GENUINE_BUSINESS_AMBIGUITY`, or
`UNEXPECTED_SYSTEM_FAILURE`. Local test/code defects, local/CI or platform
parser mismatches, stale caches, kernel false positives, and mechanically
derivable registry reconciliation are internal: reproduce, identify the shared
source, add the smallest regression, repair it, rerun the focused and
invalidated gates, then resume the original task. An unchanged tracked file
that passes exact-head CI but fails locally is first an
`ENVIRONMENT_PARITY_DEFECT`; inspect line endings, paths, process/shell
semantics, and environment. If a product PR exposes an out-of-scope kernel
defect, preserve it, repair the kernel on an isolated branch from current main,
open one kernel PR, and resume the preserved product PR after the Owner merge
gate—never discard completed work.

Final `BLOCKED` is limited to a verified external service/account/network
dependency, explicit Owner production approval, irreducible safety conflict,
genuine business-authority ambiguity, or unexpected tool/runtime failure after
one focused retry and one distinct strategy. Do not loop indefinitely. Run
impact and proof planning early for writes, RPCs, schema fields, migrations,
authorization, and cross-domain work; do not rerun a green broad suite unless a
later change invalidated it.

Production SQL and credential use are Owner-only. Never contact production,
create production dummy data, expose privileged secrets to client code, mutate
applied migrations, delete protected history, clear durable offline recovery,
or bypass approved server confirmation for Calls and Field Visits. The sole
history-deletion exception is the separately reviewed, exact-UUID, Owner-run
retired-employee operation in `docs/contracts/IDENTITY_ERASURE.md`; it is never
an application endpoint or ordinary Admin capability.
