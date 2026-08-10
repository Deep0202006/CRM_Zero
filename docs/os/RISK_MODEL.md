# Risk Model

## CURRENT

| Risk | Meaning | Required verification |
|---|---|---|
| R0 | Documentation or presentation only | scope, invariant guard, docs/lightweight relevant checks |
| R1 | Isolated behavior; no critical persistence/auth changes | scope, invariant guard, related tests, typecheck, lint |
| R2 | Business logic, critical reads/APIs/synchronization | R1 gates plus full tests and build |
| R3 | Schema, RLS, auth, production mutation, destructive operations, foundational persistence | R2 gates plus active ExecPlan and explicit production-safety checklist |

## INVARIANT

Risk escalates when changed paths or declared effects demand it. Schema/RLS/auth, production mutation, destructive operations, service-role handling, or foundational persistence are R3. Never silently downgrade; document any downgrade before implementation and obtain explicit approval where safety changes.

R3 verification is local and read-only by default. It never authorizes applying a migration or mutating production.

## KNOWN DEBT

Classification is path/pattern assisted and still requires engineering judgment for unusual cross-domain effects.
