# Dependency security review

Reviewed with `npm audit --json` on 2026-07-28. No forced or unrelated major upgrades were used.

| Package | Relationship | Surface | Assessment and action |
|---|---|---|---|
| `next` | Direct runtime | App Router, route handlers | Upgraded compatibly from 16.2.9 to 16.2.12. Build, unit, E2E discovery, and route authorization tests are required. |
| `postcss` | Transitive runtime/build | CSS compilation | Reported through Next. Compatible audit updates applied where npm could resolve them. User-controlled CSS is not processed by the CRM. Retest production build. |
| `sharp` | Transitive optional runtime | Next image optimization | Reported through Next. The repaired workflows do not process untrusted SVGs through image optimization. Retest build and existing images. |
| `brace-expansion` | Transitive development | ESLint/Jest glob matching | Exploitable only by developers/CI supplying adversarial glob patterns. The available automatic remediation requires an ESLint major upgrade, so the temporary development-only risk is accepted for this focused repair. |
| `xlsx` | Direct runtime | Admin spreadsheet import/export | No fixed npm release is offered by the audit registry. Imports are restricted to authenticated administrative workflows, size-limited in the UI, and outputs receive formula-injection escaping. Replacement with a maintained workbook parser is tracked separately because it affects all import/export contracts. |

The final audit exit code remains non-zero while registry findings without a compatible remediation remain. This is recorded as reviewed risk, not a passing zero-vulnerability claim.
