# Current invariants

- One fact has one writable authority; a label is never identity or authority.
- Retries and imports keep stable business identity, and auth identity remains
  distinct from display/profile identity.
- Privileged authorization is server-side and external projections expose the
  minimum authorized fields.
- Every write has read closure; offline compatibility preserves recovery and
  legitimate intent across versions.
- Media lifecycle and optional failures cannot undo confirmed business work.
- Receivables and effective confirmed non-reversed payments are money truth;
  ERP directory, assignment, visit observation, and current baseline remain
  separate authorities.
- Never fabricate backfill or production dummy data. Canonical ERP writes occur
  only at their authoritative boundary.
- Batches are atomic. Spreadsheet commit revalidates its resolved plan, and
  structural template changes increment the template version.
- Applied migrations are immutable. R3 changes require real runtime proof.
- Reads, exports, retries, processes, and evidence are bounded resources.
- Visualizations state their denominator, filter, timezone, unit, and failure;
  they never turn missing data into a false zero.
- Platform handover preserves business authorities, safety, rollback, and Owner
  control of production actions.
- Proof is exact-head and fresh only while head, tree, dirty state, impact, plan,
  command, runner, and environment identities remain unchanged.
- Assertions and expected behavior may not be weakened to obtain green output.
- Worktree identity is content-sensitive, and production remains behind an
  explicit human Owner gate.
