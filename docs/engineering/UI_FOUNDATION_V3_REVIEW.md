# UI Foundation V3 review

Owner source: `ZeroData-CTO-UI-Brief.md`, read completely on 2026-09-08. Section 4 only; history APIs and later section 5 product phases remain separate packets.

## Standing CTO process

For material changes: establish current state; trace entrypoints and source identities; consult relevant primary documentation; obtain independent critique; resolve differences; define scoped acceptance; implement; collect focused behavioral and actual visual evidence; verify exact-head CI; leave release to Owner manual merge. Cover integration, architecture, data, performance, frontend, CRM decision/action and independent QA responsibilities. Classify conclusions as observed, reproduced, externally reported, proposed or unverified. Reopen review only for material findings. Preserve this process in future handoffs; a new CLI session is not assumed to remember the Owner's Downloads file.

## Observed starting point and decisions

- Worktree: `.worktrees/ui-foundation-v3-20260908` relative to the primary checkout; branch `feat/ui-foundation-v3-20260908`; task `20260908-63ad49a85037` created through `crm:task` in place, no compatible unfinished task existed. The machine-specific absolute path remains in the local task packet and Owner handoff, not portable repository policy.
- Remote main verified at `2150de0e1fd3e7c84f626b58cfe66373a716a972`, matching merged PR110; no newer delta. Sync repair is excluded.
- Exact pinned component and reference sources recorded in `docs/third-party/VISUAL_INTELLIGENCE_PROVENANCE.md`. Installed Next 16.2.9 lazy-loading guide read before changing Funnel import.
- Chart inventory: 13 nested owners in six files plus Outcome donut, ActivityFlow and ERP donut = 16 responsive instances.
- Team decision: inspect today's typed employee work and its attendance/freshness context. Source is the existing validated report row; action is opening a read-only Sheet. No historical/Visits/reached-call claims or composite productivity rank.
- Visits decision: inspect exact filtered records and their loaded-page composition. ERP is a separate current-business projection, unaffected by visit filters. Evidence remains explicit click-to-load.
- Independent source critique identified duplicate ERP Retry risk, silent employee fallback, missing-as-zero tooltip behavior, missing bar-branch category summaries and long-label clipping. Implementation and behavioral cases must address these without backend changes.
- Resource requirement: no added backend query, chart request, polling, page draining or new subscription. One browser worker. Request/bundle observations are synthetic measurements, not live stress tests or free-tier headroom evidence.
- Preserve Preview isolation, authorization, INR precision, permanent history, offline recovery, confirmed Calls/Visits, My Day/Pipeline separation and all Owner-only production gates. No retired staging access, credentials, production operations, hook changes or transport workarounds.

## Reproduced local evidence

- Nine focused browser scenarios passed with one worker. Later targeted checks passed after adding exact card/sort/warning assertions, both ERP composition branches, and settled-theme contrast assertions. No chart sizing warnings were observed in the guarded scenarios.
- Nineteen registered visual/unit assertions passed, including rendered unavailable versus zero, value-only formatting, invalid Outcome/ERP reconciliation, and unsafe chart-style input. Typecheck and focused lint passed after correcting the new test fixture. Build passed against the synthetic E2E environment. Existing repository lint warnings remain; none were suppressed.
- Initial Team requests: before 1 KPI / 0 Pipeline; after 1 KPI / 0 Pipeline. Initial Visits requests: before 1 / after 1. Sheet adds none. ERP keyboard focus adds none; failed activation 1, explicit Retry 1, cached returns 0.
- Browser script-resource decoded bytes (local cold page observation, not production bundle size): Team 4,583,255 before / 4,390,816 after; Visits 4,970,318 before / 4,386,987 after. Script elements: Team 45 / 47; Visits 45 / 46. These are fixture measurements, not an uplift or infrastructure-capacity claim. Raw per-viewport observations retain the reachable script URLs and plot dimensions.
- Essential small-text samples passed 4.5:1 in both themes; lowest recorded settled sample was 5.78:1. Sampling covers primary labels, selected navigation/metric controls and panel metadata, not a claim that every legacy application screen is audited.
- Actual identical-fixture screenshots cover Team and Visits at 1440, 768 and 390 in light/dark, with additional after chart/register captures. Browser reflow checks include 320; reduced-motion checks use the existing media preference.
- Independent correctness review found no material source regression. The installed Ponytail final minimal-diff review recommended no cuts within the explicitly mandated component scope. Its missing-value proof finding was closed with executable shared rendering tests.

## Actual visual comparison

The before mobile Team screen gives equal prominence to seven cards, starting with headcount. After starts with the four requested work types, followed by supporting context, a single selected-metric chart and exact register. Visits now exposes filters and separates the all-time/today/directory population from page-local charts; its mobile register comes before secondary charts. Quiet panels remove the repeated gradient/header treatment. Exact names and values remain available in semantic tables/lists; no aesthetic score or user-study improvement is asserted.

| Screen | Before | After | After records |
| --- | --- | --- | --- |
| Team, mobile light | [Screenshot](../../artifacts/visual-review/ui-foundation-before/team-kpi-390-light.png) | [Screenshot](../../artifacts/visual-review/ui-foundation-after/team-kpi-390-light.png) | [Register](../../artifacts/visual-review/ui-foundation-after/team-kpi-390-light-register.png) |
| Visits, desktop dark | [Screenshot](../../artifacts/visual-review/ui-foundation-before/visits-1440-dark.png) | [Screenshot](../../artifacts/visual-review/ui-foundation-after/visits-1440-dark.png) | [Register](../../artifacts/visual-review/ui-foundation-after/visits-1440-dark-register.png) |

Full evidence: [before](../../artifacts/visual-review/ui-foundation-before), [after](../../artifacts/visual-review/ui-foundation-after). These are actual browser captures, not mockups or proof certificates.

## Required release boundary and remaining limits

Impact/proof planning resolved R3 with no changed business authority or write operation. Required domain proofs passed locally. Local preflight initially rejected a machine-specific documentation path (corrected); the kernel evidence test requires frozen committed-head inputs, so dirty-worktree/concurrent-evidence results are not release evidence. Required exact-head CI and PostgreSQL verification remain the release authority, not this report. No merge readiness is claimed until those checks pass.

Team remains Today-only; Visits activity remains page-local. Existing broad report/directory readers are unchanged. Historical APIs, role-adjusted comparisons, new Visits/reached-call metrics and later product phases remain separate. Production and retired staging were untouched. Owner manual merge only; stop before merge. If the host rejects normal publication before Git executes, hand off one exact Owner push command without transport workarounds or an OS repair.
