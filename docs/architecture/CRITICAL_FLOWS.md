# Critical Flows

## CURRENT

**Call:** canonicalize client identity → create stable log ID → transactionally retain local row/outbox → prepend durable employee view → prioritize this exact outbox item through the approved confirmation route → remove it only after matching confirmation → background-drain unrelated work → asynchronously refresh authoritative history/KPI.

**Field visit:** create stable visit ID with current payload marker → transactionally retain visit/media locally → confirm visit through server route → mark visit confirmed → retry evidence separately when needed. Previous supported queued payloads without pincode remain legacy-readable and reuse the same operation ID.

**Mapping:** resolve a shared client suggestion or retain trimmed free text → create a stable mapping request → durably sync only the Mapping row → complete with explicit actor attribution. No Lead creation or Pipeline transition is in this flow.

**Reporting:** authenticated server route → server-side confirmed sources → IST date bounds/attribution → validated response → UI.

**Offline recovery:** local owner-scoped records → serialized retry → same business ID → server confirmation → local status reconciliation without destructive clearing.

**Team Chat:** authenticated member → bounded authoritative API history → stable message ID → server-derived sender → database commit → private Realtime signal → member refetch/deduplicate → read-state reconciliation. Push is an opt-in alert, not message authority.

## INVARIANT

UI success for critical work follows exact server confirmation when online. Evidence cannot block a confirmed visit. Retry is idempotent and owner-scoped.
Private chat content and subscriptions remain membership-scoped; administrator capability alone does not grant DM access.

## KNOWN DEBT

Network/schema compatibility failures require multiple safe recovery states and regression tests.
