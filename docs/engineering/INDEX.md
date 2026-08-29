# ZeroData Engineering Kernel

This directory is the current compact business and engineering registry. Begin
with [ARCHITECTURE.md](ARCHITECTURE.md), then consult the exact affected contract
and only the relevant entries in DOMAIN_MAP, AUTHORITIES, CAPABILITIES, CLAIMS,
LESSONS, PROOFS, and REGRESSION_CASES.

The deterministic loop is Resolve -> Open and revalidate -> Impact -> Proof plan
-> Registered proof runner -> exact-head CI certificate. Missing evidence yields
`UNKNOWN` or `SCOPE_AMBIGUOUS`; it never grants write scope. The source index and
session state are caches under Git metadata, not committed task authority.

Graphify is optional read-only navigation for ambiguous cross-domain structure.
The Owner remains the only production SQL and deployment authority. Platform
handover stays governed by [PLATFORM_HANDOVER.md](PLATFORM_HANDOVER.md).
