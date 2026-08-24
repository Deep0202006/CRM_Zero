# CRM Engineering Intelligence

This directory is the compact engineering knowledge layer. Current product
code, schema, tests, exact `docs/contracts/**`, and GitHub CI remain
authoritative implementation evidence.

Start with [ARCHITECTURE.md](ARCHITECTURE.md), then use
[DOMAIN_MAP.json](DOMAIN_MAP.json), [AUTHORITIES.json](AUTHORITIES.json),
[CAPABILITIES.json](CAPABILITIES.json), [LESSONS.json](LESSONS.json),
[INVARIANTS.md](INVARIANTS.md), and the exact contract named by the domain.

Focused context is for a concrete task: resolve it with `--task` plus a current
`--path`, then open the referenced source and contracts. Platform context is a
compact discovery map (`--mode platform`); it does not authorize a product or
schema write, which must return to focused evidence. Prefer query, targeted
read, then modification; never preload the registry, history, or graph cache.
