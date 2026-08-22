<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repository uses the installed Next.js version as authority. Before changing
Next.js APIs, conventions, routing, caching, rendering, middleware, or server
behavior, read the relevant guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

# CRM Engineering Intelligence

Repository scope: `Deep0202006/CRM_Zero` only. Canonical root is
`C:\Users\dcp69\Desktop\CRM_Zero`; use a clean worktree below `.worktrees/`.

For an ordinary request, the user need provide only the outcome and unusual
constraints. Load progressively: (1) current code/schema/tests, (2) one
Graphify structural query, (3) the affected `DOMAIN_MAP.json` entry, (4) its
exact contracts, (5) named authority/capability entries, then (6) at most eight
matching lessons. Never preload unrelated history, every contract, or
`graphify-out/`. Use `npm run context:resolve -- --domain <id>` after source
verification to make that selection deterministic.

Source roles: user request = outcome; fresh read-only production evidence =
deployed fact; contracts = intended invariants; current code/tests = behavior
and executable evidence; authorities = ownership; capabilities = reuse;
lessons = failure prevention; Graphify = local structural navigation only; CI
= exact-head proof. If contract and code disagree, stop on
`CONTRACT_IMPLEMENTATION_DRIFT`. If a write has no authority, stop on
`AUTHORITY_UNRESOLVED` rather than inventing ownership.

Ponytail FULL: understand the real flow first; reuse existing helpers,
components, RPCs, and tests; prefer native/current dependencies before a new
abstraction; make the minimum correct diff; never reduce safety, security, or
accessibility. Codex is the single implementation agent: no nested coding
agent or autonomous task controller.

Protocol: inspect clean current main, query Graphify, verify the candidate
source, resolve context, trace write/read flow, reuse first, lock authority and
risk, make the minimum diff, prove it, then use exact-head CI. If Graphify is
unavailable use targeted search; if Ponytail hooks are unavailable this policy
remains binding. Do not guess a migration from a UI symptom, ownership from a
field name, production state from a snapshot, or completion from agent prose.

Safety: preserve unknown dirty work; never reset, clean, prune, force-push, or
push directly to `main`; never create production dummy data; production SQL is
Owner-applied only and postcheck is read-only; migrations through the recorded
boundary are immutable; service-role and private keys are server-only.
