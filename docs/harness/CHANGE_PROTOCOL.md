# Change protocol

1. Create the task capsule.
2. Review inferred database/UI impact and allowed paths.
3. Add a narrow exception with justification when necessary.
4. Update status in `.codex-artifacts/task-state.json`.
5. Run quick checks while editing.
6. Run full verification and detached review before release.

Route/RPC changes require their declarative contract or contract test in the same scope. New production files require an affected-test mapping.
