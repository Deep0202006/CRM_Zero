# Troubleshooting

- No task state: run `harness:new`.
- Out-of-scope path: revert it or add a narrow approved exception and justification.
- Missing affected tests: update the owning area capsule.
- Locked migration changed: restore it and add the next migration.
- SQL mismatch: copy the exact migration into the manual apply file.
- Missing E2E credentials: discovery still runs; acceptance is explicitly `SKIPPED`.
- Failed command: inspect the recorded stdout/stderr path under `.codex-artifacts/runs/`.
