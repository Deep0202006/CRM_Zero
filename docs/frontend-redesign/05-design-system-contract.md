# 05 Design System Contract: Design Tokens & Geometry

## 1. CSS Custom Properties (`src/design-system/tokens.css`)

```css
:root {
  /* Surfaces */
  --surface-canvas: #f5f6f8;
  --surface-primary: #ffffff;
  --surface-secondary: #f0f2f5;
  --surface-elevated: #ffffff;
  --surface-sidebar: #121418;
  --surface-sidebar-hover: #1c1f25;
  --surface-sidebar-active: #252932;
  --surface-hover: #f4f5f7;
  --surface-selected: color-mix(in srgb, var(--brand-500) 9%, white);
  --surface-disabled: #f1f2f4;
  --surface-overlay: rgba(15, 18, 24, 0.48);

  /* Typography */
  --text-primary: #17191d;
  --text-secondary: #555d68;
  --text-muted: #7b8490;
  --text-disabled: #a8afb8;
  --text-inverse: #f7f8fa;

  /* Borders */
  --border-subtle: #e8eaee;
  --border-default: #dce0e5;
  --border-strong: #c8ced6;

  /* Brand Accents */
  --brand-50: color-mix(in srgb, var(--brand-500) 7%, white);
  --brand-100: color-mix(in srgb, var(--brand-500) 14%, white);
  --brand-500: #5b5bd6;
  --brand-600: color-mix(in srgb, var(--brand-500) 88%, black);
  --brand-700: color-mix(in srgb, var(--brand-500) 76%, black);

  /* Status Colors */
  --status-success: #18794e;
  --status-success-soft: #e9f7ef;
  --status-warning: #a85d00;
  --status-warning-soft: #fff3dc;
  --status-danger: #c73535;
  --status-danger-soft: #fdecec;
  --status-info: #2d6fc2;
  --status-info-soft: #eaf2fc;
  --status-neutral: #68717d;
  --status-neutral-soft: #eef0f3;
  --status-pending: #7c5cbe;
  --status-pending-soft: #f1edfa;

  /* Spacing Scale (px) */
  --space-0: 0px;  --space-1: 2px;  --space-2: 4px;  --space-3: 6px;  --space-4: 8px;
  --space-5: 12px; --space-6: 16px; --space-7: 20px; --space-8: 24px; --space-9: 32px;
  --space-10: 40px;--space-11: 48px;--space-12: 64px;--space-13: 80px;--space-14: 96px;

  /* Geometry & Radius */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-round: 999px;

  /* Elevation */
  --shadow-raised: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-popover: 0 12px 32px rgba(15, 23, 42, 0.14);
  --shadow-dialog: 0 24px 64px rgba(15, 23, 42, 0.22);
}
```

## 2. Geometry Contract
- Default Button: Height `36px`, padding `12px`, radius `8px`, font `13px/18px weight 600`.
- Compact Control: Height `32px`, padding `10px`.
- Mobile Primary Button: Minimum height `44px`, padding `16px`.
- Inputs & Selects: Height `38px` (desktop), `44px` (mobile), radius `8px`. Focus ring `2px` `--brand-500`.
