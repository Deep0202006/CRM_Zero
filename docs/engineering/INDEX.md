# CRM Engineering Intelligence

This directory is the compact engineering knowledge layer. Current product
code, schema, tests, exact `docs/contracts/**`, and GitHub CI remain
authoritative implementation evidence.

Start with [ARCHITECTURE.md](ARCHITECTURE.md), then use
[DOMAIN_MAP.json](DOMAIN_MAP.json), [AUTHORITIES.json](AUTHORITIES.json),
[CAPABILITIES.json](CAPABILITIES.json), [LESSONS.json](LESSONS.json),
[CLAIMS.json](CLAIMS.json), [PROOFS.json](PROOFS.json),
[INVARIANTS.md](INVARIANTS.md), and the exact
contract named by the domain. `LEGACY_KNOWLEDGE` is certification provenance,
not ordinary task context; Golden cases exercise its preserved claims.

Focused context accepts a natural-language `--task` without path hints, then
opens the returned current source and contracts. Platform context is a
compact discovery map (`--mode platform`); it does not authorize a product or
schema write, which must return to focused evidence. Prefer query, targeted
read, then modification; never preload the registry, history, or graph cache.

The executable loop is Task -> Resolve -> Implement -> Impact -> Prove ->
Certify -> Learn -> End. `task:close` enforces current task evidence after the
OS installation is healthy. The semantic graph is generated in Git metadata.
Graphify adds optional navigation evidence only. Production remains behind the
Owner gate. Supabase movement uses the R3 [platform contract](PLATFORM_HANDOVER.md).
