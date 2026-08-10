---
name: zd-adversarial-review
description: Use before handoff of a non-trivial ZeroData change to challenge scope, safety, and harness quality.
---
# ZD Adversarial Review

Required inputs: diff, manifest, verification results.

Workflow: compare diff to scope; challenge authority/recovery/error paths; inspect guard false positives/negatives; search duplicated guidance and hidden production dependencies; confirm product code changes are intentional.

Docs: `docs/quality/GOLDEN_PRINCIPLES.md`, affected contracts, `docs/os/RISK_MODEL.md`.

Checks: no giant instruction blob, stale SHA/date, permissive scope, destructive behavior, external-only assumptions, or token-heavy output.

Output: severity-ranked findings, fixes made, residual risks.
