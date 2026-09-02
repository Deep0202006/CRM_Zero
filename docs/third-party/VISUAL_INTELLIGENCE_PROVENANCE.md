# Visual Intelligence Component Provenance

Reviewed 2026-09-02. Local files are maintained through ordinary code review; no automatic upstream updates are enabled.

| Upstream | Component/pattern reviewed | License | Local adaptation |
|---|---|---|---|
| `shadcn-ui/ui` commit `b2a1ec864a87ba66c63fc4e51c9223c7eb4f8335`, `apps/v4/registry/new-york-v4/ui/chart.tsx` | Chart config, container sizing, CSS-variable tokens, tooltip and legend composition | MIT | `src/components/analytics/Chart.tsx` is an original compact ZeroData adaptation used by local compositions; no registry runtime or verbatim component added. |
| `recharts/recharts` 3.x; installed `recharts@3.9.1` | Bar, Pie, responsive sizing, tooltip and accessibility composition | MIT | Sole chart runtime used by local analytics components. |
| `tremorlabs/tremor` main, Tracker v1 composition; `tremorlabs/tremor-npm` | Tracker and analytical panel hierarchy | Apache-2.0 | `UrgencyTracker` is an original dependency-free ZeroData composition; no Tremor package or source file copied. |
| `magicuidesign/magicui` main | NumberTicker and restrained BlurFade concepts | MIT | `NumberTicker.tsx` uses a small native `requestAnimationFrame` implementation; panel entry uses local CSS. Motion was intentionally not installed, and reduced motion is respected. |
