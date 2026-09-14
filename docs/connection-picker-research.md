# Connection Selector & Menu — UI Research

> Research question: what is the best possible UI for XDB's topbar connection selector (`connection-picker-trigger`) and its dropdown menu (`connection-picker-menu`)?
>
> Sources consulted: TablePlus docs, DataGrip docs, DBeaver docs, Beekeeper Studio release notes/config, W3C WAI-ARIA Authoring Practices (Combobox Pattern), Nielsen Norman Group dropdown guidelines. All claims link to their primary source.

## 1. How leading database clients do it

### TablePlus — keyboard-first switching
- Switching databases *inside* a connection is `⌘K`; the full connection list is `⌘⇧K`. Every picker surface has a shortcut; the mouse path is secondary ([TablePlus docs](https://docs.tableplus.com/gui-tools/untitled)).
- Takeaway: **a global quick-switch shortcut is table stakes**; the dropdown is not the primary fast path.

### DataGrip — separate config from session state
- Connection configs ("data sources") live in one dialog; *connection sessions* (live vs. disconnected) are a separate concept surfaced in a Sessions list next to the data-source selector ([Run queries — DataGrip docs](https://www.jetbrains.com/help/datagrip/run-a-query.html)).
- Management (create/duplicate/test) happens in the Data Sources dialog, not inside the switcher popup ([Data sources — DataGrip docs](https://www.jetbrains.com/help/datagrip/managing-data-sources.html)).
- Takeaway: **the switcher should switch; it shouldn't be a management console.** Editing/deleting/import/export belong behind an explicit entry point ("Edit connections…"), not as four icon buttons crowding the menu header.

### DBeaver — filters over structure
- Database Navigator offers "Show all connections / Show connected only" toggle and object filtering directly in the toolbar ([Database Navigator — DBeaver docs](https://dbeaver.com/docs/dbeaver/Database-Navigator)).
- Takeaway: **filtering by state (connected only) beats scrolling** once the list grows past ~10 items.

### Beekeeper Studio — recents + quick search + light-touch organization
- Sidebar keeps a bounded "Recent connections" list (`recentConnectionsLimit`, default 10) above saved connections ([Beekeeper config reference](https://docs.beekeeperstudio.io/user_guide/configuration)).
- Global Quick Search `⌘/Ctrl+P` jumps to tables and saved queries ([Release 2.1](https://www.beekeeperstudio.io/category/release)); reorganization was later consolidated into one consistent move-to flow instead of scattered context-menu entries, plus inline renaming ([5.x releases](https://github.com/beekeeper-studio/beekeeper-studio/releases)).
- Takeaway: **recently used connections deserve their own section**, and renaming/moving should never require leaving the list.

## 2. Interaction-pattern guidance (authoritative)

### W3C WAI-ARIA APG — Combobox Pattern
The current XDB menu is `role="menu"` with buttons inside — a mismatch: `menu` expects `menuitem` descendants and command semantics, not value selection with nested groups. The correct pattern is an **editable combobox with a listbox popup** ([W3C APG](https://www.w3.org/WAI/ARIA/apg/patterns/combobox)):

- Trigger/input carries `role="combobox"`, `aria-expanded`, `aria-controls` → popup `role="listbox"` with `role="option"` children; DOM focus stays on the input, visual focus moves via `aria-activedescendant`.
- Keyboard contract: `↓/↑` move options (wrap allowed), `Enter` accepts/connects, `Esc` closes without changing anything, printable characters type into the filter, `Home/End` optional.
- Selection follows focus in the listbox; the collapsed control shows the current value.
- For nested groups, a **tree popup** is the sanctioned variant (groups as non-selectable category labels); a flat filtered listbox that flattens group names into the match string is simpler and usually better.

### NN/G — when dropdowns work
- Dropdowns degrade quickly past ~15 options without typeahead; users can't scan what they can't see ([Dropdowns: Design Guidelines](https://www.nngroup.com/articles/drop-down-menus), [Listboxes vs. Dropdown Lists](https://www.nngroup.com/articles/listbox-dropdown)).
- Menus are for commands; selecting an object (a connection) is fine in a dropdown, but *rare commands* (import/export) buried as icons in a header have poor discoverability ([Menu-Design Checklist](https://www.nngroup.com/articles/menu-design)).
- Avoid deep nesting/cascading; keep the most-used item closest to the trigger (Fitts's law).

## 3. Problems in the current XDB implementation

Observed in `apps/web/src/renderer/App.tsx` (~L3192–3540) and `apps/web/src/renderer/styles/app.css`:

1. **No search/filter.** With >10 connections the only mechanism is scrolling — the exact failure mode NN/G warns about.
2. **No keyboard navigation.** No arrow keys, no Enter-to-connect, no type-ahead. TablePlus/Beekeeper treat keyboard switching as the main path.
3. **Wrong ARIA semantics.** `role="menu"` + `aria-haspopup="menu"` on the trigger, but content is selectable values in groups. Should be combobox + listbox (or tree).
4. **Management clutter.** Header stacks a count pill + 4 icon-only buttons (New / New group / Import / Export). Icon-only, unlabeled, rarely-used commands in a transient popup are undiscoverable.
5. **Drag handles tax every row.** A permanent 16px grid column for drag-and-drop that most sessions never use; DnD affordance should appear on hover/selection, not reserve layout space.
6. **Color leaks.** Row status dots use `profile.color` inline styles — violates the achromatic DESIGN.md rule ("Do not use chromatic accents… no colored status pills").
7. **Two-line trigger eats the topbar.** 44px tall × up to 45vw wide for information (subtitle) that is available inside the menu.
8. **No recents.** Every open requires hunting through the full tree even though usage follows a power law.
9. **Shadow on the menu** (`box-shadow: 0 16px 44px …`) contradicts DESIGN.md's "no shadows" rule — separation should come from tone + border.
10. **Hover-reveal actions** (`opacity: 0 → 1`) on row actions are invisible until hovered — poor discoverability and impossible to see which actions exist via keyboard alone.

## 4. Recommended design

### Structure

```
┌────────────────────────────────────────────┐   ← trigger: compact, single line
│ ▤ prod-postgres        ● Connected    ⌄ │      name + engine + state, ~36px
└────────────────────────────────────────────┘
              ↓ opens
┌────────────────────────────────────────────┐
│ 🔍 Filter connections…            ⌘K     │   ← autofocused filter input
├────────────────────────────────────────────┤
│ RECENT                                     │   ← auto section, max ~5
│ ● prod-postgres        postgres · aws  ✓ │
│ ○ local-dev            sqlite · ~/dev.db  │
│ GROUPS                                       │
│ ▾ Client Work            [rename/edit ⋯]   │
│   ● analytics-rds       mysql · rds.us…  ✓ │
│   ○ reporting           postgres · …      │
├────────────────────────────────────────────┤
│ + New connection          Manage…  Import │   ← one primary + overflow
└────────────────────────────────────────────┘
```

### Behavior

| Concern | Recommendation | Basis |
|---|---|---|
| Fast path | Global `⌘K` / `Ctrl+K` opens the same picker focused on the filter; typing filters fuzzy across name/host/engine/group | TablePlus ⌘K; Beekeeper ⌘P |
| Filter | Auto-focused input at menu top; matches name, host, group; flattens groups into results while filtering | APG editable-combobox; NN/G typeahead |
| Keyboard | `↓↑` navigate, `Enter` connect, `Esc` close-no-change, `Home/End` bounds | APG combobox keyboard map |
| Recents | Bounded auto-list (~5) of last-connected, above groups | Beekeeper recentConnectionsLimit |
| State filter | One toggle: All / Connected only | DBeaver "Show connected only" |
| Semantics | `role="combobox"` + `aria-expanded` + `aria-controls` → `listbox`/`option`, `aria-activedescendant`; current connection gets `aria-selected` | W3C APG |
| Management | Keep only `+ New connection` inline; collapse New group / Import / Export / bulk-edit into a "Manage connections…" screen or `⋯` overflow | DataGrip separates config mgmt; NN/G menu checklist |
| Drag & drop | Remove reserved handle column; show grip on hover/selected row only; keep right-click context menu for edit/duplicate/delete | Beekeeper inline-org; current hover-opacity problem |
| State display | Achromatic: filled dot = connected, hollow = disconnected, plus text tone; drop `profile.color` | DESIGN.md monochrome rule |
| Trigger | Single-line ~34–36px: engine glyph, truncated name, state dot, chevron; full metadata lives in the menu | compact-density DESIGN.md |
| Menu chrome | Panel bg + 1px `--border-subtle`, 10px radius, no box-shadow (tone separation only) | DESIGN.md borders/shadow rules |

### Sizing (XDB tokens)

- Trigger: height 34–36px (down from 44px), radius 10px, border `--border-subtle`.
- Menu width: 320–360px; max-height `min(480px, calc(100vh − 96px))`.
- Rows: single-line, 28–30px tall, 12–13px mono; metadata appended muted after name instead of a second line where possible.
- Section headers: 11px uppercase muted labels (`RECENT`, `GROUPS`), 19px spacing token between sections.

## 5. Implementation sketch (files)

- `App.tsx`: refactor `ConnectionPicker` trigger/menu into combobox semantics; add filter state, keyboard handler, recents section, manage-overflow.
- `styles/app.css`: rewrite `.connection-picker-*` block — remove shadow, add `.connection-picker-filter`, `.picker-section-label`, single-line rows, hover-grip.
- Shared recents tracking likely belongs in `src/main/store.ts` (connections store already persisted as JSON).
