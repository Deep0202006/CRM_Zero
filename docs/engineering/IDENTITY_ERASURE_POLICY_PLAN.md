# Retired Employee Identity Erasure Policy — Active R3 Plan

## Outcome

Preserve default Class-A permanence while defining one narrow exact-UUID, dry-run-first, production-Owner exception. Remove the existing generic Admin deletion surface. This task prepares policy and regression guards only; it performs no production mutation.

## Invariants

- Independent customer/company facts and other employees' work survive.
- No reusable app endpoint, UI action, RPC, migration, cron, or CI mutation.
- Exact UUID identity and complete dependency closure precede any future execute artifact.
- Unknown dependency, Auth drift, or concurrent count drift aborts.
- Production credentials and production systems are out of scope.

## Checklist

- [x] Current lifecycle, employee authority, Admin UI, and deletion route inspected.
- [x] Generic deletion path identified as incompatible with the requested policy.
- [x] Policy and lifecycle contracts encode default permanence and the narrow exception.
- [x] Generic Admin delete UI/API removed.
- [x] Static regression proves exact-ID, dry-run, Owner, preservation, and no-endpoint rules.
- [x] Fictional employee-name placeholders neutralized; legitimate business names untouched.
- [x] Impact compiles as R3 with no unresolved authority.
- [ ] Registered exact-head proofs and readiness pass.

## Rollback and irreversibility

This branch changes source and documentation only and is fully revertible before merge. It contains no SQL execute artifact and no production operation. Any future database transaction rolls back before commit; Auth deletion and identity erasure are irreversible human gates documented in the contract.
