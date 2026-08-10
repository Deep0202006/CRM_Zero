---
name: zd-release
description: Use when preparing a verified ZeroData branch for PR, preview, merge, or emergency hotfix handoff.
---
# ZD Release

Required inputs: branch, risk, manifest, verification, rollback.

Workflow: read release protocol; ensure clean scoped diff; run risk gates; prepare concise PR; push feature branch without force; verify preview/required checks where available.

Docs: `docs/os/RELEASE_PROTOCOL.md`, `.github/PULL_REQUEST_TEMPLATE.md`.

Checks: never direct-to-main, no production credentials/connections, data/schema effects explicit.

Output: branch, PR, checks, preview status, rollback, manual repository setting.
