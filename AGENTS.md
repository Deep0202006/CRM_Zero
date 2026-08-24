<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repository uses the installed Next.js version as authority. Before changing
Next.js APIs, conventions, routing, caching, rendering, middleware, or server
behavior, read the relevant guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

# CRM Engineering Intelligence

Repository scope: `Deep0202006/CRM_Zero` only. Canonical root is
`C:\Users\dcp69\Desktop\CRM_Zero`; use a clean worktree below `.worktrees/`.

Load progressively: current code/schema/tests, one Graphify query, the affected
domain entry and exact contracts, named authority/capability entries, then
lessons selected by deterministic task relevance and resolver token budget.
Use `npm run context:resolve -- --task "<summary>" --path <path>` after source
verification. Never preload unrelated history, every contract, or graph cache.

Source roles: user request = outcome; fresh read-only production evidence =
deployed fact; contracts = intended invariants; current code/tests = behavior;
authorities = ownership; capabilities = reuse; lessons = failure prevention;
Graphify = a locator, never authority; CI = exact-head proof. Docs do not
overrule fresh source or deployed evidence. Confirm Graphify findings by opening
current source; unsupported assumptions are not evidence. If contract and code
disagree, stop on `CONTRACT_IMPLEMENTATION_DRIFT`. If a write has no authority,
stop on `AUTHORITY_UNRESOLVED` rather than inventing ownership.

Ponytail FULL: understand the flow, reuse existing helpers/components/RPCs/tests,
make the minimum correct diff, and never reduce safety, security, or
accessibility. One direct Codex only: no nested coding agents or controller.

Ordinary workflow: (1) verify clean source, (2) `npm run graphify:sync`, (3) one
bounded Graphify query (~600 tokens), (4) open candidate source, (5) resolve
task-aware context, (6) read exact contracts/authority/capability, (7) minimum
diff, (8) focused tests, (9) exact-head CI. For platform-wide discovery use
`--mode platform`, then return to focused context before each write. If Graphify
is unavailable use targeted search. Do not guess migrations, ownership,
production state, or completion from symptoms, snapshots, or agent prose.

Safety: preserve unknown dirty work; never reset, clean, prune, force-push, or
push directly to `main`; never create production dummy data; production SQL is
Owner-applied and postcheck is read-only; applied migrations are immutable;
service-role and private keys are server-only.

Memory policy: do not expand LESSONS or DOMAIN_MAP merely because a bug occurred.
Prevent it through shared implementation, validation/invariant, and regression
test first; add a durable lesson only for cross-cutting judgment that cannot be
mechanically enforced. Invalid knowledge, unresolved authority, security,
schema/production gates, and relevant failing tests remain blocking.
