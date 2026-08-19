# Legacy governance policy

Pre-graph governance is preserved for provenance and lessons, but is not
execution authority.

The context compiler excludes:
- `docs/os/**`;
- `.harness/**`;
- archived worktrees;
- completed historical plans;
- repair folders;
- vendor/build/test-output directories.

A task may explicitly import a historical fact, decision or incident. Imported
facts must be normalized into current authority/lesson/proof structures before
they can affect a decision.

This prevents old plans, stale production checkpoints and abandoned branch
instructions from silently steering a current task.
