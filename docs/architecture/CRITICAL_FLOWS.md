# Critical Flows

## CURRENT

**Call:** canonicalize client identity → create stable log ID → transactionally retain local row/outbox → prepend durable employee view → prioritize this exact outbox item through the approved confirmation route → remove it only after matching confirmation → background-drain unrelated work → asynchronously refresh authoritative history/KPI.

**Field visit:** create stable visit ID → transactionally retain visit/media locally → confirm visit through server route → mark visit confirmed → retry evidence separately when needed.

**Reporting:** authenticated server route → server-side confirmed sources → IST date bounds/attribution → validated response → UI.

**Offline recovery:** local owner-scoped records → serialized retry → same business ID → server confirmation → local status reconciliation without destructive clearing.

## INVARIANT

UI success for critical work follows exact server confirmation when online. Evidence cannot block a confirmed visit. Retry is idempotent and owner-scoped.

## KNOWN DEBT

Network/schema compatibility failures require multiple safe recovery states and regression tests.
