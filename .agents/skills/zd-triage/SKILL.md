---
name: zd-triage
description: Use when diagnosing a ZeroData defect or uncertain domain ownership before planning a change.
---
# ZD Triage

Required inputs: observed outcome, affected role/screen, timing, and available evidence.

Workflow: run harness preflight; classify affected domains; read only their contracts and tests; trace current authority/recovery path; separate fact, inference, and unknown; assign provisional risk.

Docs: `docs/os/INDEX.md`, `docs/architecture/`, affected `docs/contracts/`.

Checks: no mutation, no fabricated reproduction data, no production queries unless explicitly authorized read-only.

Output: concise cause/evidence, affected domains, risk, missing evidence, and recommended next action.
