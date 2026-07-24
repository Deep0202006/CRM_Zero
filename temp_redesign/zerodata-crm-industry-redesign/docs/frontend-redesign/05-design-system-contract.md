# 05 Design System Contract

## Implemented direction

The frontend uses a single **graphite, deep-teal and mineral-neutral** visual system. The authenticated CRM is deliberately operational rather than cinematic: compact navigation, calm surfaces, strong typography, full-width workspaces, precise tables, contextual drawers and restrained motion.

The only expressive storytelling surface is `/login`, where the brand logo appears first and the supporting product story reveals on scroll.

## Source of truth

All visual values are centralized in:

- `src/design-system/tokens.css`
- `src/app/globals.css`

Feature routes must use semantic variables and shared components. They must not introduce independent hex values, ad-hoc shadows, unrelated radii, or separate component libraries.

## Implemented token families

- Surfaces: canvas, primary, secondary, tertiary, elevated, sidebar, hover, selected, disabled and overlays.
- Typography: primary, secondary, muted, disabled and inverse text.
- Brand: teal scale from `--brand-50` through `--brand-900`.
- Status: success, warning, danger, information, neutral and pending, each with a soft surface.
- Charts: five route-safe chart tokens.
- Geometry: spacing scale, radii, borders, shell widths and top-bar height.
- Elevation: controls, cards, popovers, dialogs, brand emphasis and login presentation.
- Motion: feedback, standard, overlay and emphasis durations with shared easing.
- Layering: sticky content, top bar, sidebar, dropdown, popover, drawer, modal, toast and command palette.

## Core geometry

| Element | Implemented contract |
|---|---|
| Expanded sidebar | `264px` |
| Collapsed sidebar | `76px` |
| Top utility bar | `64px` |
| Default input | `40px` minimum height |
| Default button | `36–40px`, depending on variant |
| Mobile primary control | minimum `44px` target where workflow-critical |
| Operational panel | `--radius-lg` with subtle border and restrained elevation |
| Modal | `--radius-xl`, maximum `88dvh` |
| Record inspector | full width on small screens, `460px` on desktop |

## Shared component contract

Routes must prefer these components:

- `Button`
- `Input`
- `Card`
- `Chip`
- `Modal`
- `PageHeader`
- `MetricCard`
- `EmptyState`
- `Skeleton`
- `SearchableSelect`
- `RecordInspector`
- `CommandPalette`

## Motion policy

Operational screens use short opacity, translation and presence transitions only. The login experience uses CSS transforms and opacity, limited animation iterations, `IntersectionObserver`, `content-visibility`, and reduced-motion fallbacks. No Three.js, WebGL, GSAP, autoplay video or permanent decorative animation is shipped.
