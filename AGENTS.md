<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repository uses the installed Next.js version as authority. Before changing
Next.js APIs, conventions, routing, caching, rendering, middleware, or server
behavior, read the relevant guide under `node_modules/next/dist/docs/`.
<!-- END:nextjs-agent-rules -->

# CRM_Zero Engineering

Repository scope: `Deep0202006/CRM_Zero` only.

Canonical engineering sources, in order:

1. Current product code, schema, and tests.
2. `docs/contracts/**`.
3. `docs/engineering/AUTHORITIES.json`.
4. `docs/engineering/CAPABILITIES.json`.
5. `docs/engineering/LESSONS.md`.
6. `supabase/migrations/APPLIED_OWNER_MIGRATIONS.json`.

Implementation discipline:

- Use Graphify first for topology when it is available and fresh.
- Follow Ponytail FULL discipline: reuse existing code first and make the
  smallest correct diff without unnecessary dependencies or abstractions.
- Codex is one direct implementation agent; do not use nested coding agents or
  an autonomous task controller.

Safety:

- Preserve dirty owner work and use a clean isolated worktree for changes.
- Never reset, clean, prune, force-push, or push directly to `main`.
- Never create production dummy data.
- Only the Owner manually applies reviewed production migration SQL; postcheck
  is read-only.
- Applied owner migrations are immutable; use a forward migration.
- Service-role keys remain server-only.
