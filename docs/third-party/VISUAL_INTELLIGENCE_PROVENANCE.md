# Visual Intelligence Component Provenance

Reviewed 2026-08-15. Local files are maintained through ordinary code review; no automatic upstream updates are enabled.

| Upstream | Component/pattern reviewed | License | Local adaptation |
|---|---|---|---|
| `shadcn-ui/ui` main, `apps/v4/registry/new-york-v4/ui/chart.tsx` | Chart container sizing, theme tokens, tooltip composition | MIT | `src/components/analytics/AnalyticsPanel.tsx`, `CompositionCharts.tsx`, `MetricOrbit.tsx` use ZeroData tokens and existing primitives; no registry runtime or verbatim component added. |
| `recharts/recharts` 3.x; installed `recharts@3.9.1` | RadialBar, Pie, Area, Radar, responsive sizing, accessibility layer | MIT | Sole chart runtime used by local analytics components. |
| `tremorlabs/tremor` main, Tracker v1 composition; `tremorlabs/tremor-npm` | Tracker and analytical panel hierarchy | Apache-2.0 | `UrgencyTracker` is an original dependency-free ZeroData composition; no Tremor package or source file copied. |
| `magicuidesign/magicui` main | NumberTicker and restrained BlurFade concepts | MIT | `NumberTicker.tsx` uses a small native `requestAnimationFrame` implementation; panel entry uses local CSS. Motion was intentionally not installed, and reduced motion is respected. |
