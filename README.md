# CRM Zero

CRM Zero is a Next.js CRM backed by Supabase, with role-scoped operational,
field-visit, distributor, pipeline, and receivables workflows.

Run `npm ci`, then use `npm run dev`, `npm test`, `npm run typecheck`, and
`npm run build` as appropriate. CI is the final exact-head verification.

This README is descriptive, not an authority registry. For current engineering
semantics use `AGENTS.md`, `docs/engineering/**`, `docs/contracts/**`, and
current code/tests. Production migrations are Owner-applied only; the recorded
migration boundary is immutable and production postchecks are read-only.
