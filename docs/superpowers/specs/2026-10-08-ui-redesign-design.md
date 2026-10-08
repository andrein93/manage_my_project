# mmp UI Redesign — Design Spec

Date: 2026-10-08 · Status: draft for review · Builds on: Core, Organize, Time, Finance, Extras specs

## Purpose

Make the web dashboard look and feel like a modern, crafted tool in the Linear / Vercel style
(inspired by 21st.dev components), with purposeful motion and a few showcase effects, without
changing what the dashboard does.

Success criteria: every page (Overview, Projects, Project detail, Tasks, Time, Finance, Clients,
Client detail, Settings) uses the new design system; navigation is a sidebar plus a Ctrl/Cmd+K
command palette; motion is present on page changes, lists, stats and charts and is fully off
under `prefers-reduced-motion`; `vue-tsc`, `npm test` and `npm run build` pass; every page has
been checked in the browser in dark, light and mobile widths.

## Scope

In scope: styling, layout shell, shared UI components, motion, command palette, theme switch.

Out of scope: API, server, CLI, MCP, data model, route paths, page behavior and copy (existing
i18n strings are kept; only new strings are added). No new pages.

## Decisions

- **Own design system** built on Tailwind 4 tokens, not a third-party component kit.
  21st.dev / Aceternity / Magic UI effects are re-implemented in Vue in our style.
- **New dependencies (web only):** `motion-v` (Motion for Vue, Framer Motion API) and
  `lucide-vue-next` (icons, per-icon imports). Fonts: `@fontsource-variable/geist` and
  `@fontsource-variable/geist-mono` replace Schibsted Grotesk and Fragment Mono.
- **Dark-first** palette; light theme kept. Theme preference `system | light | dark` is a
  client-side preference stored in `localStorage` (same pattern as the language preference in
  `web/src/i18n.ts`), applied as `data-theme` on `<html>` before first paint (inline script in
  `web/index.html`) to avoid a flash.

## Visual system

`web/src/style.css` is rewritten. Existing semantic token names are kept so current utility
classes keep working: `paper`, `surface`, `ink`, `muted`, `line`, `action`, `action-ink`,
`fresh`, `aging`, `dormant`, `danger`, `chart`. Added: `surface-2` (raised surface),
`line-strong`, `glow` (accent at low alpha), radius scale (`sm 6px`, `md 8px`, `lg 12px`,
`xl 16px`) and two shadows (`card`, `pop`).

Dark (default when system is dark or `data-theme="dark"`):
paper `#0a0b0f`, surface `#111318`, surface-2 `#171a21`, line `rgb(255 255 255 / 0.08)`,
line-strong `rgb(255 255 255 / 0.14)`, ink `#ececf1`, muted `#8b8d98`, action `#7c7cff`,
action-ink `#0a0b0f`, fresh `#3ccf92`, aging `#e0b53c`, dormant `#6b6f7b`, danger `#f0776e`,
chart `#7c7cff`.

Light: paper `#fafafa`, surface `#ffffff`, surface-2 `#f4f4f6`, line `rgb(0 0 0 / 0.08)`,
line-strong `rgb(0 0 0 / 0.14)`, ink `#16171d`, muted `#62646f`, action `#5b5bf0`,
action-ink `#ffffff`, fresh `#1f9d6b`, aging `#b8901a`, dormant `#8a8d98`, danger `#c4372f`,
chart `#5b5bf0`.

Selection rules: `[data-theme="dark"]` and `[data-theme="light"]` force a theme;
without the attribute (`system`), `prefers-color-scheme` decides.

Typography: Geist for UI, Geist Mono for numbers, paths and code; `tabular-nums` on all
figures. Page titles 24px/semibold/tight tracking; section labels 12px uppercase muted with
wide tracking.

The legacy component classes `.btn`, `.btn-primary` and `.field` stay as aliases restyled to
the new look, so views can migrate incrementally.

## Layout shell

`web/src/App.vue` becomes:

- **Sidebar** (left, 240px; collapsed 56px icons-only, preference in `localStorage`): logo,
  nav items with Lucide icons, animated active indicator (shared `layoutId` pill), ⌘K search
  button, Rescan button at the bottom. Below the `md` breakpoint it is a slide-in drawer opened
  from a menu button in the topbar.
- **Topbar** (thin, inside the content column): mobile menu button (below `md`) and the
  command palette trigger with its `UiKbd` hint.
- **Toasts** replace the inline notice/error lines: rescan result and errors from `useErrors`
  appear bottom-right, animate in/out, auto-dismiss (errors stay until dismissed).
- **Content** keeps `max-w-6xl` and is wrapped in the page transition.

## Command palette

`web/src/components/CommandPalette.vue`, opened with Ctrl/Cmd+K or the sidebar button.

- Groups: Pages (static nav list), Projects (`api.projects({})`), Tasks (`api.tasks({})`, open
  tasks only), Clients (`api.clients()`), Actions (Rescan, Theme: system/light/dark).
- Data is fetched when the palette first opens and refreshed on `scanTick` change.
- Client-side fuzzy match (subsequence match with score: prefix > word start > contiguous),
  max 8 results per group.
- Keyboard: ↑/↓ move, Enter run, Esc close; focus trapped while open; returns focus to the
  trigger on close. Selecting a task navigates to its project page.
- Matching lives in a pure function in `web/src/palette.ts` so it is unit-testable.

## UI components (`web/src/ui/`)

| Component | Purpose |
|---|---|
| `UiButton` | variants `primary`, `secondary`, `ghost`, `danger`; sizes `sm`, `md`; icon slot; press scale |
| `UiCard` | surface with border/radius; optional `spotlight` prop enables `SpotlightCard` effect |
| `UiBadge` | small status/tag pill; tones `neutral`, `accent`, `fresh`, `aging`, `dormant`, `danger` |
| `UiInput`, `UiSelect` | styled form controls (thin wrappers keeping native elements and `v-model`) |
| `UiStat` | label + value using `NumberTicker`; optional delta/tone |
| `UiEmpty` | empty state: icon, title, hint, optional action |
| `UiSkeleton` | shimmer placeholder for loading states |
| `UiKbd` | keyboard hint chip |
| `UiToast` / `useToasts` | toast stack and composable |
| `PageHeader` | title, optional subtitle, actions slot — used by every view |

Effects (`web/src/ui/effects/`): `NumberTicker`, `SpotlightCard`, `BorderBeam`, `DotGrid`
(background with radial fade + subtle aurora in dark), `StaggerList`.

## Motion

Library: `motion-v`. Only `transform` and `opacity` are animated (plus SVG `pathLength` for
charts).

- Page transition: fade + 4px rise, 180ms, `mode="out-in"`.
- Lists and grids: children enter staggered (30ms step, capped at 10 items so long lists don't
  wait).
- Stats: `NumberTicker` counts from previous value to new value (600ms, ease-out).
- Bars (Overview, Time, Finance) grow from 0 width; `DailyChart` bars/lines draw in.
- Buttons: press scale 0.97; palette, drawer and toasts open with a spring.
- Tasks: layout animation when a task is completed/reordered.
- Showcase effects, limited to: `SpotlightCard` on Overview cards and project cards,
  `BorderBeam` on the Overview hero card, `DotGrid` background on Overview.
- `useReducedMotion()` composable (wrapping `matchMedia('(prefers-reduced-motion: reduce)')`)
  disables all motion and effects; spotlight and beam only run on `(pointer: fine)`.

## Pages

Each view adopts `PageHeader`, `UiCard`, `UiButton`, `UiBadge`, `UiEmpty`, `UiSkeleton` and the
motion rules above. Logic, API calls, i18n keys and routes are unchanged. Components in
`web/src/components/` (StatusMark, FreshnessStrip, TaskItem, DailyChart, etc.) are restyled in
place. `SettingsView` gains an Appearance section with the theme switch next to the language
setting.

## i18n

New strings (sidebar collapse, palette placeholders/groups/empty state, theme labels, toast
dismiss) are added to every `web/src/locales/*.json` file; `tests/locales.test.ts` keeps all
locales in shape.

## Testing and verification

- Unit tests for `palette.ts` fuzzy matching and for the theme preference resolver.
- `npm run typecheck`, `npm test`, `npm run build`; report web bundle size before and
  after (target: under +80 KB gzip).
- Browser check of every page in dark, light and ~390px width, with and without reduced
  motion; keyboard-only run through the command palette.
