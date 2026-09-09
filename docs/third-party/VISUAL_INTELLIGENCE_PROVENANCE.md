# Visual Intelligence Component Provenance

Reviewed 2026-09-08. Local files are maintained through ordinary code review; no automatic upstream updates are enabled.

## UI Foundation V3

Pinned source: [shadcn-ui/ui@5c7072da672b0048bc6771e3204063a2537df91a](https://github.com/shadcn-ui/ui/tree/5c7072da672b0048bc6771e3204063a2537df91a/apps/v4/registry/new-york-v4).
All paths below are relative to `apps/v4/registry/new-york-v4/`.

| Exact source | Local destination / use | Adaptation |
|---|---|---|
| `ui/tabs.tsx` | `src/components/ui/Tabs.tsx` | Official Radix composition, existing teal tokens, 44px controls, controlled page consumers. |
| `ui/chart.tsx` | `src/components/analytics/Chart.tsx` | Official responsive owner, existing import boundary, deterministic sizes, safe unique IDs and CSS keys/colors, `data-theme` selectors, legacy color aliases, value-only formatter, explicit unavailable value, en-IN grouping and legend fallback. |
| `ui/sheet.tsx` | `src/components/ui/Sheet.tsx` | Official Dialog composition, existing overlay/layer tokens, full-width mobile, scrollable content, 44px close control; no animation dependency. |
| `ui/card.tsx` | `src/components/ui/Card.tsx` | Action/Footer composition only; existing variants and h3 semantics retained. |
| `blocks/dashboard-01/components/section-cards.tsx` | `src/components/ui/MetricCard.tsx` structure reference | Real typed metrics, Lucide icons, existing tokens; no demo trends or Tabler dependency. |
| `charts/chart-bar-horizontal.tsx` | Horizontal comparison reference | Full semantic labels, numeric axes and exact values; no demo data or trend. |
| `charts/chart-pie-donut-text.tsx` | Outcome / ERP composition reference | Existing exact center totals, hover behavior, accessible category values, bars above six nonzero categories. |
| `charts/chart-area-interactive.tsx` | `src/components/analytics/TeamHistory.tsx`, reviewed 2026-09-09 | Pinned interactive-area composition adapted to one selected typed metric, linear interpolation, disconnected gaps, fixed 320px panel, exact table and native date/select controls. No demo records, stacked unlike measures, smooth trajectory, new dependency or trend claim. Existing Chart and MIT notice retained. |

Exact added dependencies: `radix-ui@1.6.7`, `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`.
Availability and React 19 compatibility verified from the npm registry on 2026-09-08. Installed one package per operation using `--save-exact --ignore-scripts --registry=https://registry.npmjs.org`.
Existing Recharts, Lucide, React and Next versions are retained. `cn` is a local utility, not an installed package.

### Copied source license

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Packet A workspace makeover · 2026-09-09

Pinned free source: `tremorlabs/tremor@ca4d588f47820ff3d514d37fa4ee08a4222dec11`,
`src/components/CategoryBar/CategoryBar.tsx`. Local destination:
`src/components/analytics/CompositionStrip.tsx`, consumed by VisitsIntelligence
for the exact loaded-page outcome partition. Changes: semantic theme tokens,
integer/total reconciliation, exact visible accessible values, explicit empty
state, and existing supported outcome-filter actions. Unused marker, tooltip
and color-library machinery is omitted. No Tremor package or dependency added.

The pinned repository tree contains LICENSE and no NOTICE file. Its complete
Apache-2.0 license and included third-party notices are retained in
`docs/third-party/TREMOR_LICENSE`. Sparkline and Tracker remain reference-only:
there is no evidenced distinct consumer requiring copied source.

The existing pinned shadcn Chart/Sheet/Tabs primitives remain unchanged. Team
History now uses a compact 220px panel with the same linear/gap and exact-table
semantics; desktop detail reuses its content in a non-modal context rail.

## Earlier composition references

| Upstream | Component/pattern reviewed | License | Local adaptation |
|---|---|---|---|
| `shadcn-ui/ui` commit `71e50952fbb7eda2c992660d36cd58671a2edf42`, `apps/v4/registry/new-york-v4/ui/chart.tsx` | Chart config, container sizing, CSS-variable tokens, tooltip and legend composition | MIT | `src/components/analytics/Chart.tsx` is an original compact ZeroData adaptation used by local compositions; no registry runtime or verbatim component added. |
| `recharts/recharts` 3.x; installed `recharts@3.9.1` | Bar, Pie, responsive sizing, tooltip and accessibility composition | MIT | Sole chart runtime used by local analytics components. |
| `tremorlabs/tremor` main, Tracker v1 composition; `tremorlabs/tremor-npm` | Tracker and analytical panel hierarchy | Apache-2.0 | `UrgencyTracker` is an original dependency-free ZeroData composition; no Tremor package or source file copied. |
| `magicuidesign/magicui` main | NumberTicker and restrained BlurFade concepts | MIT | `NumberTicker.tsx` uses a small native `requestAnimationFrame` implementation; panel entry uses local CSS. Motion was intentionally not installed, and reduced motion is respected. |
