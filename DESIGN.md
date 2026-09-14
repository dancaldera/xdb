# PixQL — Style Reference
> monospaced control room for database work. Black-and-white operational surfaces, catalog-like labels, no decoration.

**Themes:** light + dark

PixQL follows the 099 Supply reference as a local web database client: an aggressively achromatic interface, one monospaced voice, compact operational surfaces, and hierarchy created through tone, borders, position, and density — not color, shadows, gradients, icons-as-decoration, or font-weight changes. The product should feel like a precise database console: quiet, technical, and confident.

The dark theme is the primary expression: pure black canvas, carbon panels, white text. The light theme is the inverse working mode: white canvas, black text, restrained gray borders, and the same monospaced density. Both themes share one design language and one token model.

## Core Rules

- Use only achromatic colors: black, white, and neutral grays.
- Do not use chromatic accents for actions, status, charts, tabs, or selections.
- Do not use gradients, glows, or box-shadows in application UI.
- Use one monospaced typeface everywhere, weight 400 only.
- Use 10px radius for all standard controls, panels, inputs, tabs, and cards.
- Use compact density for database workflows.
- Communicate state through border, fill, text tone, and placement.
- Keep default borders quiet: 1px hairlines in `--border-subtle` (Smoke). Reserve full-contrast `--border-strong` (Bone/Ink) for focus and active states only.

## Tokens — Dark Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Void | `#000000` | `--color-void` | Page canvas, app shell background, deepest workspace |
| Carbon | `#161616` | `--color-carbon` | Panels, sidebars, cards, inputs, table headers |
| Smoke | `#2e2e2e` | `--color-smoke` | Default borders, dividers, outlines; quiet separation against Void and Carbon |
| Graphite | `#383838` | `--color-graphite` | Hover fills, inactive controls, selected-row fills |
| Ash | `#888888` | `--color-ash` | Muted text, metadata, helper labels, placeholders |
| Bone | `#ffffff` | `--color-bone` | Primary text, active labels, high-contrast controls |

## Tokens — Light Colors

The light theme keeps the same monochrome restraint. It inverts emphasis without introducing new hues.

| Name | Value | Token | Role |
|------|-------|-------|------|
| Bone | `#ffffff` | `--color-void` | Page canvas, app shell background |
| White Surface | `#ffffff` | `--color-carbon` | Panels, cards, inputs; separated by borders, not shadows |
| Smoke Line | `#d4d4d4` | `--color-smoke` | Default borders, dividers, outlines; soft hairlines on white |
| Graphite | `#888888` | `--color-graphite` | Inactive controls, hover accents |
| Graphite Text | `#383838` | `--color-ash` | Muted text, metadata, helper labels, placeholders |
| Ink | `#000000` | `--color-bone` | Primary text, active labels, high-contrast controls |

## Semantic Theme Tokens

Use these in implementation so components do not branch by theme.

```css
:root,
html[data-theme="dark"] {
  color-scheme: dark;
  --color-void: #000000;
  --color-carbon: #161616;
  --color-graphite: #383838;
  --color-smoke: #2e2e2e;
  --color-ash: #888888;
  --color-bone: #ffffff;

  --surface-base: var(--color-void);
  --surface-panel: var(--color-carbon);
  --surface-control: var(--color-carbon);
  --surface-selected: var(--color-bone);
  --text-primary: var(--color-bone);
  --text-muted: var(--color-ash);
  --border-subtle: var(--color-smoke);
  --border-strong: var(--color-bone);
}

html[data-theme="light"] {
  color-scheme: light;
  --color-void: #ffffff;
  --color-carbon: #ffffff;
  --color-graphite: #888888;
  --color-smoke: #d4d4d4;
  --color-ash: #383838;
  --color-bone: #000000;

  --surface-base: var(--color-void);
  --surface-panel: var(--color-carbon);
  --surface-control: var(--color-carbon);
  --surface-selected: var(--color-bone);
  --text-primary: var(--color-bone);
  --text-muted: var(--color-ash);
  --border-subtle: var(--color-smoke);
  --border-strong: var(--color-bone);
}
```

## Tokens — Borders

Borders are a two-level system. Default chrome must stay quiet; contrast is earned through state, not applied everywhere.

| Level | Token | Dark Value | Light Value | When to use |
|-------|-------|------------|-------------|-------------|
| Subtle (default) | `--border-subtle` / `whisper-border` / `ghost-border` | `#2e2e2e` | `#d4d4d4` | Panel edges, card outlines, inputs, tabs, dialogs, grid lines, dividers — anything always visible |
| Strong (state) | `--border-strong` | `#ffffff` | `#000000` | Focus rings, active tab border, editing-cell outline — only when signaling interaction or selection |

Rules:
- Never use `--border-strong` as a resting-state border; if a control needs emphasis at rest, use a tone or fill shift instead.
- Hover states may lift `--border-subtle` one step (e.g. to `--color-graphite`) but should not jump straight to full contrast.
- All borders are 1px. Never thicken borders for hierarchy.

## Tokens — Typography

### Mono — Sole typeface across all roles · `--font-mono`

- **Preferred:** Soehne Mono when available.
- **Substitutes:** JetBrains Mono, IBM Plex Mono, Space Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace.
- **Weight:** 400 only.
- **Base size:** 16px for product/marketing surfaces; 12-14px for dense data tables and toolbars.
- **Letter spacing:** `0.015em` globally.
- **OpenType:** `font-feature-settings: "zero" 1;` for slashed-zero legibility.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| dense | 12px | 1.2 | 0.015em | `--text-dense` |
| ui-sm | 13px | 1.25 | 0.015em | `--text-ui-sm` |
| ui | 14px | 1.3 | 0.015em | `--text-ui` |
| caption | 16px | 1.2 | 0.015em | `--text-caption` |

## Tokens — Spacing & Shapes

**Base unit:** 4px  
**Density:** compact for the app shell, spacious only for landing/empty states

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 5 | 5px | `--spacing-5` |
| 6 | 6px | `--spacing-6` |
| 8 | 8px | `--spacing-8` |
| 10 | 10px | `--spacing-10` |
| 16 | 16px | `--spacing-16` |
| 19 | 19px | `--spacing-19` |
| 27 | 27px | `--spacing-27` |
| 32 | 32px | `--spacing-32` |

### Border Radius

| Element | Value |
|---------|-------|
| tabs | 10px |
| cards | 10px |
| inputs | 10px |
| buttons | 10px |
| dense icon controls | 7-8px |

### Layout

- **App shell:** full viewport.
- **Landing max-width:** 1280px.
- **Section gap:** 32px on landing pages.
- **Panel gap:** 0-1px in the app shell; adjacent panels separate by borders.
- **Card padding:** 19-27px for marketing/catalog cards; 8-12px for app panels.
- **Element gap:** 6-8px in app chrome; 16px in landing/catalog layouts.

## Components

### App Topbar
**Role:** Connection, workspace, and app utility chrome.

Height 46-50px. Background `--surface-base` or `--surface-panel` depending on context. Text uses mono 13-14px weight 400. Separate zones with 1px `--border-subtle` dividers. No shadows. No colored status pills.

### Database Sidebar
**Role:** Tables, views, schemas, storage buckets, and connection objects.

Width 252px default, resizable 216-360px. Background `--surface-panel`. Items are one line, truncated, mono 13px. Active item uses inverted selection: `--surface-selected` fill and base-colored text. Hover uses border or tone shift only.

### Data Table
**Role:** Highest-density data workspace.

Header background `--surface-panel`; body background `--surface-base`. 1px `--border-subtle` grid lines. Cells use 3-4px vertical and 6px horizontal padding. Text 12-13px mono. No zebra color beyond allowed gray tones. Selection uses inverted monochrome treatment.

### Query Editor
**Role:** SQL writing and execution surface.

Background `--surface-base` with `--border-subtle` frame. Text is mono. Syntax highlighting must remain achromatic: primary text, muted comments, strong white/black keywords through tone only. Avoid chromatic SQL syntax colors.

### Button
**Role:** All actions.

10px radius, 1px border, mono 13-14px, weight 400. Height 28-30px in chrome; 24-26px in dense table controls.

- **Primary:** filled `--text-primary` / `--surface-selected` with inverted label.
- **Secondary:** transparent or panel fill with `--border-subtle` border.
- **Danger:** no red; use stronger border, confirmation copy, and position.

### Input / Select / Filter Control
**Role:** Forms, connection setup, filters, search.

Background `--surface-control`, border `--border-subtle`, 10px radius, mono text. Focus uses `--border-strong`; do not add glow.

### Tabs
**Role:** Object tabs, mode tabs, settings tabs.

10px radius. Active tab uses inverted monochrome fill or a strong border. Preview/temporary tabs can use dashed border and italic text, but keep weight 400.

### Dialog / Drawer
**Role:** Settings, connection forms, destructive confirmations.

Background `--surface-panel`, 1px `--border-subtle`, 10px radius. Padding 12px in app. No backdrop blur, no shadow; modal separation comes from tone and border.

Dialog interiors stay **flat**: inner zones (toolbars, sidebars, tab strips, input wells) are transparent with hairline borders — never filled with a lighter panel tone. In dark mode this avoids patchy gray slabs inside an otherwise void-black dialog.

### Loading Indicator
**Role:** Async work.

Thin circular spinner using `--text-primary` stroke on `--surface-base` or `--surface-panel`. No text unless needed for accessibility.

## Do's and Don'ts

### Do

- Use only the approved monochrome tokens.
- Keep all type monospaced and weight 400.
- Use 10px radius consistently.
- Let layout, alignment, catalog-like labels, and data density provide rhythm.
- Use inverted monochrome states for active/selected elements.
- Keep database workflows compact and table-first.

### Don't

- Do not introduce chromatic colors for success, danger, warning, charts, database engines, or actions.
- Do not add gradients, shadows, glows, or glass effects to application UI.
- Do not use proportional fonts.
- Do not vary font weight for hierarchy.
- Do not use pill radius `9999px`; radius stays 10px.
- Do not add decorative icons or illustrations to chrome.

## Surfaces

### Dark

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Void | `#000000` | Base canvas and deep workspace |
| 2 | Carbon | `#161616` | Panels, cards, inputs, table headers |
| 3 | Bone | `#ffffff` | Inverted active states and primary text |

### Light

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 1 | Bone | `#ffffff` | Base canvas and workspace |
| 2 | Bordered White | `#ffffff` | Panels and cards separated by gray borders |
| 3 | Ink | `#000000` | Inverted active states and primary text |

## PixQL Application Adaptations

- Treat the app as a control room, not a marketing page: full viewport, compact panels, clear borders.
- Keep connection management, schema browsing, query writing, results, filters, pagination, and row editing within the same monochrome system.
- Database engine identity should be text-first; avoid colored PostgreSQL/MySQL/SQLite badges in core chrome.
- Object tabs preserve per-object state. Dirty state uses a monochrome dot or label, not color.
- Filter toolbars and bottom action bars use dense controls and 1px separators.
- Export, backup, restore, destructive actions, and license states use copy and confirmation hierarchy instead of color semantics.

## Agent Prompt Guide

**Quick Color Reference — Dark**
- background: `#000000`
- panel/card: `#161616`
- border (subtle): `#2e2e2e`
- border (strong/focus): `#ffffff`
- hover/inactive fill: `#383838`
- muted text: `#888888`
- primary text/action: `#ffffff`

**Quick Color Reference — Light**
- background: `#ffffff`
- panel/card: `#ffffff`
- border (subtle): `#d4d4d4`
- border (strong/focus): `#000000`
- hover/inactive accent: `#888888`
- muted text: `#383838`
- primary text/action: `#000000`

**Example Component Prompts**

1. Create a compact database toolbar: 48px high, monochrome mono text, 1px gray bottom border, 28px controls with 10px radius. Primary action is inverted black/white depending on theme. No shadows, gradients, or color accents.
2. Create a data-grid row: 12-13px monospaced text, 3px vertical and 6px horizontal cell padding, 1px monochrome grid lines. Selected row uses inverted monochrome fill.
3. Create a connection card: 1px gray border, 10px radius, 12px padding, mono labels, muted metadata. No engine colors; show engine as text.
4. Create a tab row: 10px radius tabs, 1px border, active tab inverted monochrome, preview tab dashed border and italic text. All text weight 400.
5. Create a settings dialog: panel background, 1px border, 10px radius, 12px padding, compact inputs. Focus state is a stronger monochrome border only.

## Quick Start

### CSS Custom Properties

```css
:root {
  --font-mono: 'Soehne Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Space Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-dense: 12px;
  --text-ui-sm: 13px;
  --text-ui: 14px;
  --text-caption: 16px;
  --tracking-mono: 0.015em;

  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-5: 5px;
  --spacing-6: 6px;
  --spacing-8: 8px;
  --spacing-10: 10px;
  --spacing-16: 16px;
  --spacing-19: 19px;
  --spacing-27: 27px;
  --spacing-32: 32px;

  --radius-lg: 10px;
  --radius-tabs: 10px;
  --radius-cards: 10px;
  --radius-inputs: 10px;
  --radius-buttons: 10px;
}

html {
  font-family: var(--font-mono);
  font-weight: 400;
  letter-spacing: var(--tracking-mono);
  font-feature-settings: "zero" 1;
}
```

### Tailwind v4

```css
@theme {
  --color-void: #000000;
  --color-carbon: #161616;
  --color-graphite: #383838;
  --color-smoke: #2e2e2e;
  --color-ash: #888888;
  --color-bone: #ffffff;

  --font-mono: 'Soehne Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Space Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  --text-dense: 12px;
  --text-ui-sm: 13px;
  --text-ui: 14px;
  --text-caption: 16px;

  --spacing-4: 4px;
  --spacing-5: 5px;
  --spacing-6: 6px;
  --spacing-8: 8px;
  --spacing-10: 10px;
  --spacing-16: 16px;
  --spacing-19: 19px;
  --spacing-27: 27px;
  --spacing-32: 32px;

  --radius-lg: 10px;
}
```
