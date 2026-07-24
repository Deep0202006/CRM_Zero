# 06 Route Acceptance Matrix

All user-interface routes were structurally redesigned. A route is not counted as complete merely because its colours changed.

| Route | Structural redesign delivered | Main implemented experience |
|---|---|---|
| `/login` | Yes | Logo-first brand reveal, editorial hero, secure form, lightweight operational mock, scroll story and reduced-motion behaviour |
| `/` | Yes | Operational overview, attention-first scorecards, queue/activity composition and management shortcuts |
| `/my-day` | Yes | Daily execution workspace, role-specific metrics, target queue, weekly digest, accessible completion and deletion workflows |
| `/onboarding` | Yes | Pipeline board, filters, structured lead creation, stage workflows and record inspector |
| `/call-logs` | Yes | Split logging/history workspace, actionable metrics, search and export |
| `/mappings` | Yes | Guided mapping workspace, linked records, queue states and responsive controls |
| `/support` | Yes | Service desk composition, issue triage, status workflows and record context |
| `/attendance` | Yes | Office/field verification, camera/location states, attendance history and restricted-state guidance |
| `/admin` | Yes | User and capability management console, creation workflow, status controls and system feedback |
| `/admin/attendance` | Yes | Team attendance scorecards, filters, responsive table and export |
| `/manager/tasks` | Yes | Guided task assignment plus validated spreadsheet intake, city mapping, workload distribution and confirmation modal |
| `/manager/kpi` | Yes | Management scorecards, attention queues, accessible tables, funnel, velocity, source and pipeline analysis |

## Shared structural categories changed

1. Application shell and navigation.
2. Page hierarchy and workspace composition.
3. Information density and grouping.
4. Data interaction and filtering.
5. Record/workflow interaction.
6. Responsive behaviour.

## Runtime acceptance still required on the target machine

After `npm ci`, run the commands in `QA_AND_RUNBOOK.md` and review every target viewport. Static source verification passed in the handoff environment, but a browser renderer was unavailable because dependencies could not be downloaded there.
