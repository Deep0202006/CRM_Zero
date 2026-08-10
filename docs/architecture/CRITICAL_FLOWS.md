# Critical Flows

## CURRENT

**Call:** create stable log ID → retain locally/pending → POST approved confirmation route → retain confirmed server row → refresh authoritative history.

**Field visit:** create stable visit ID → transactionally retain visit/media locally → confirm visit through server route → mark visit confirmed → retry evidence separately when needed.

**Reporting:** authenticated server route → server-side confirmed sources → IST date bounds/attribution → validated response → UI.

**Offline recovery:** local owner-scoped records → serialized retry → same business ID → server confirmation → local status reconciliation without destructive clearing.

## INVARIANT

UI success for critical work follows exact server confirmation when online. Evidence cannot block a confirmed visit. Retry is idempotent and owner-scoped.

## KNOWN DEBT

Network/schema compatibility failures require multiple safe recovery states and regression tests.
