# Migration 030 decision

Repository evidence reviewed on 2026-07-28:

- `docs/data-platform-repair/implementation-state.yaml` records `sql_applied: false`.
- `docs/data-platform-repair/00-current-architecture.md` states production SQL was not applied.
- no deployment log records migration 030 execution in any environment;
- the branch introduced migration 030 after the last documented live migration work.

Determination: migration 030 has never been applied in any repository-documented environment. It is therefore completed in place as the single coordinated forward migration. Migrations 029 and older remain unchanged.

This is a repository-evidence determination only. The operator must still run the read-only precheck before manual SQL execution.
