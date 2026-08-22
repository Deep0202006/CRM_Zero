# Current invariants

- Preserve business history and durable offline recovery; retries retain stable
  business IDs and confirmed work survives evidence/media failure.
- One fact has one authority; cross-domain readers do not become writers.
- Privileged authorization and critical writes are server-authoritative; secrets
  and private keys never reach browser code.
- Production has no dummy business data. The Owner alone applies reviewed SQL;
  postchecks are read-only and applied migrations are forward-only immutable.
- Receivables and effective confirmed non-reversed payments are money truth.
  Operational screens do not mutate financial authority.
- Hot reads are explicit, filtered, bounded, and non-polling; no protected hot
  path uses `SELECT *` or N+1 fan-out.
- Schema, RLS, auth, destructive, and foundational persistence changes require
  R3 disposable-runtime proof and isolation coverage.
