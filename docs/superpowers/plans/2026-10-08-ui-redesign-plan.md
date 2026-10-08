# mmp UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the web dashboard in a Linear/Vercel style with a sidebar, a Ctrl/Cmd+K command palette, purposeful motion and a few showcase effects, without changing behavior.

**Architecture:** Tokens in `web/src/style.css` keep their current semantic names, so existing utility classes keep working while views migrate. Pure, unit-tested modules (`prefs.ts`, `theme.ts`, `motion.ts`, `toasts.ts`, `palette.ts`) hold all logic; Vue components in `web/src/ui/` and `web/src/ui/effects/` are thin. Views are migrated one group per task, logic untouched.

**Tech Stack:** Vue 3.5, vue-router 5, vue-i18n 11, Tailwind CSS 4, Vite 8, Vitest 5, `motion-v` 2.x, `lucide-vue-next` 1.x, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`.

**Spec:** `docs/superpowers/specs/2026-10-08-ui-redesign-design.md`

## Global Constraints

- Web dependencies go in `devDependencies` (the web app is prebuilt into `dist/web`), like the existing ones.
- No changes to `src/` (server, CLI, MCP, core), API calls, route paths, page behavior or existing i18n keys/values.
- Every new UI string is added to **both** `web/src/locales/en.json` and `web/src/locales/it.json`; `tests/locales.test.ts` must pass.
- Only `transform` and `opacity` are animated (plus SVG `pathLength`); all motion and effects off under `prefers-reduced-motion: reduce`; spotlight and beam only on `(pointer: fine)`.
- Theme preference `system | light | dark` in `localStorage` key `mmp.theme`; sidebar state in `mmp.sidebar`. Every storage access tolerates a throwing/absent `localStorage`.
- Lucide icons imported one by one (`import { Folder } from 'lucide-vue-next'`), never the whole set.
- Web bundle growth target: under +80 KB gzip versus the baseline recorded in Task 1.
- Pure modules under `web/src/*.ts` that tests import must not import `vue-i18n`, `vue-router` or `.vue` files.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `localStorage` throwing (private window, blocked storage) → theme and sidebar fall back to defaults, page still renders. Test in Task 1 (`tests/web-theme.test.ts`).
2. Palette queries with accents, case differences or regex characters (`città`, `C++`, `(`) → match case/diacritic-insensitively and never throw. Test in Task 4.
3. Ctrl/Cmd+K pressed while focus is inside an input or the browser's own Ctrl+K → palette opens, browser default prevented; Ctrl+Shift+K / Alt+K ignored. Test in Task 4 (`isPaletteShortcut`).
4. Long lists (hundreds of projects/tasks) → stagger delay capped so item 200 doesn't wait 6 s. Test in Task 2 (`staggerDelay`).
5. Reduced motion on → number tickers show the final value immediately and stagger delay is 0. Test in Task 2.

---

## File map

Create:
- `web/src/prefs.ts` — safe localStorage read/write.
- `web/src/theme.ts` — theme preference parse/read/write/apply + reactive state.
- `web/src/motion.ts` — `staggerDelay`, `tween`, `reducedMotion`, `finePointer`.
- `web/src/toasts.ts` — toast store.
- `web/src/palette.ts` — fuzzy scoring, grouping, shortcut detection.
- `web/src/ui/UiButton.vue`, `UiCard.vue`, `UiBadge.vue`, `UiStat.vue`, `UiEmpty.vue`, `UiSkeleton.vue`, `UiKbd.vue`, `PageHeader.vue`, `UiToastStack.vue`
- `web/src/ui/effects/NumberTicker.vue`, `StaggerItem.vue`, `BorderBeam.vue`, `DotGrid.vue`
- `web/src/components/AppSidebar.vue`, `CommandPalette.vue`, `ThemeSettings.vue`
- `tests/web-theme.test.ts`, `tests/web-motion.test.ts`, `tests/web-toasts.test.ts`, `tests/web-palette.test.ts`

Modify: `package.json`, `web/index.html`, `web/src/style.css`, `web/src/App.vue`, every file in `web/src/views/` and `web/src/components/`, `web/src/locales/en.json`, `web/src/locales/it.json`.

`UiInput`/`UiSelect` from the spec are **not** created: the restyled `.field` class on native elements already gives the look and keeps `v-model`/`:value` untouched (YAGNI). `StaggerList` from the spec is implemented as `StaggerItem` (per-item wrapper), which works with existing `v-for` markup.

---

### Task 1: Foundations — dependencies, fonts, tokens, theme

**Files:**
- Modify: `package.json`, `web/index.html`, `web/src/style.css`
- Create: `web/src/prefs.ts`, `web/src/theme.ts`
- Test: `tests/web-theme.test.ts`

**Interfaces:**
- Produces: `readPref(key: string): string | null`, `writePref(key: string, value: string | null): void` (prefs.ts); `type ThemePreference = 'system' | 'light' | 'dark'`, `THEME_KEY`, `parseThemePreference(raw)`, `readThemePreference()`, `applyThemePreference(pref, root?)`, `themePreference: Ref<ThemePreference>`, `setThemePreference(pref)` (theme.ts). CSS tokens/utilities: `bg-paper|surface|surface-2`, `border-line|line-strong`, `text-ink|muted`, `bg-action`, `text-action-ink`, `ring-glow`, `shadow-card`, `shadow-pop`, classes `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.field`, `.card`, `.label`, `.skeleton`, `.spotlight`, `.border-beam`, `.dot-grid`.

- [ ] **Step 1: Record the bundle baseline**

Run: `npm run build:web` then `node -e "const fs=require('fs'),z=require('zlib');let t=0;for(const f of fs.readdirSync('dist/web/assets'))if(/\.(js|css)$/.test(f))t+=z.gzipSync(fs.readFileSync('dist/web/assets/'+f)).length;console.log('gzip js+css',t)"`
Write the number down; Task 11 compares against it.

- [ ] **Step 2: Install dependencies**

Run: `npm install -D motion-v@^2.6.0 lucide-vue-next@^1.0.0 @fontsource-variable/geist@^5.3.0 @fontsource-variable/geist-mono@^5.3.0`
Then: `npm uninstall @fontsource-variable/schibsted-grotesk @fontsource/fragment-mono`

- [ ] **Step 3: Write the failing theme tests**

`tests/web-theme.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPref, writePref } from '../web/src/prefs'
import { THEME_KEY, applyThemePreference, parseThemePreference, readThemePreference } from '../web/src/theme'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('prefs', () => {
  it('round-trips and removes values', () => {
    const s = memoryStorage()
    vi.stubGlobal('localStorage', s)
    writePref('k', 'v')
    expect(readPref('k')).toBe('v')
    writePref('k', null)
    expect(s.data.has('k')).toBe(false)
  })

  it('survives a throwing storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(readPref('k')).toBeNull()
    expect(() => writePref('k', 'v')).not.toThrow()
  })
})

describe('theme', () => {
  it('parses only known preferences', () => {
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference('purple')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
  })

  it('reads the stored preference', () => {
    const s = memoryStorage()
    s.setItem(THEME_KEY, 'light')
    vi.stubGlobal('localStorage', s)
    expect(readThemePreference()).toBe('light')
  })

  it('applies data-theme only for explicit choices', () => {
    const attrs = new Map<string, string>()
    const root = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    }
    applyThemePreference('dark', root)
    expect(attrs.get('data-theme')).toBe('dark')
    applyThemePreference('system', root)
    expect(attrs.has('data-theme')).toBe(false)
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run tests/web-theme.test.ts`
Expected: FAIL — cannot resolve `../web/src/prefs`.

- [ ] **Step 5: Implement `web/src/prefs.ts`**

```ts
// Per-browser UI preferences. Storage can be missing or throw (private windows,
// blocked site data), so every access is guarded and falls back to defaults.

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function readPref(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** `null` removes the key. */
export function writePref(key: string, value: string | null): void {
  try {
    const s = storage()
    if (value === null) s?.removeItem(key)
    else s?.setItem(key, value)
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}
```

- [ ] **Step 6: Implement `web/src/theme.ts`**

```ts
import { ref } from 'vue'
import { readPref, writePref } from './prefs'

export type ThemePreference = 'system' | 'light' | 'dark'
export const THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark']
/** Also read by the inline script in web/index.html — keep the two in sync. */
export const THEME_KEY = 'mmp.theme'

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(readPref(THEME_KEY))
}

type ThemeRoot = Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>

/** 'system' leaves no attribute, so the prefers-color-scheme media query decides. */
export function applyThemePreference(pref: ThemePreference, root: ThemeRoot = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
}

export const themePreference = ref<ThemePreference>(readThemePreference())

export function setThemePreference(pref: ThemePreference): void {
  themePreference.value = pref
  writePref(THEME_KEY, pref === 'system' ? null : pref)
  applyThemePreference(pref)
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/web-theme.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Pre-paint theme script in `web/index.html`**

Replace the `<head>` content with:

```html
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>mmp</title>
    <script>
      // Apply the stored theme before first paint (key must match THEME_KEY in src/theme.ts).
      try {
        var theme = localStorage.getItem('mmp.theme')
        if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme)
      } catch (e) {}
    </script>
```

- [ ] **Step 9: Rewrite `web/src/style.css`**

```css
@import 'tailwindcss';
@import '@fontsource-variable/geist';
@import '@fontsource-variable/geist-mono';

/* Light */
:root {
  --paper: #fafafa;
  --surface: #ffffff;
  --surface-2: #f4f4f6;
  --ink: #16171d;
  --muted: #62646f;
  --line: rgb(0 0 0 / 0.08);
  --line-strong: rgb(0 0 0 / 0.14);
  --action: #5b5bf0;
  --action-ink: #ffffff;
  --glow: rgb(91 91 240 / 0.14);
  --fresh: #1f9d6b;
  --aging: #b8901a;
  --dormant: #8a8d98;
  --danger: #c4372f;
  --chart: #5b5bf0;
  --card-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
  --pop-shadow: 0 16px 48px -12px rgb(0 0 0 / 0.25);
  --aurora-opacity: 0;
  color-scheme: light;
}

/* Dark: forced, or system preference when no explicit light choice. Keep both blocks identical. */
:root[data-theme='dark'] {
  --paper: #0a0b0f;
  --surface: #111318;
  --surface-2: #171a21;
  --ink: #ececf1;
  --muted: #8b8d98;
  --line: rgb(255 255 255 / 0.08);
  --line-strong: rgb(255 255 255 / 0.14);
  --action: #7c7cff;
  --action-ink: #0a0b0f;
  --glow: rgb(124 124 255 / 0.18);
  --fresh: #3ccf92;
  --aging: #e0b53c;
  --dormant: #6b6f7b;
  --danger: #f0776e;
  --chart: #7c7cff;
  --card-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 1px 2px rgb(0 0 0 / 0.4);
  --pop-shadow: 0 24px 64px -16px rgb(0 0 0 / 0.7);
  --aurora-opacity: 0.55;
  color-scheme: dark;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --paper: #0a0b0f;
    --surface: #111318;
    --surface-2: #171a21;
    --ink: #ececf1;
    --muted: #8b8d98;
    --line: rgb(255 255 255 / 0.08);
    --line-strong: rgb(255 255 255 / 0.14);
    --action: #7c7cff;
    --action-ink: #0a0b0f;
    --glow: rgb(124 124 255 / 0.18);
    --fresh: #3ccf92;
    --aging: #e0b53c;
    --dormant: #6b6f7b;
    --danger: #f0776e;
    --chart: #7c7cff;
    --card-shadow: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 1px 2px rgb(0 0 0 / 0.4);
    --pop-shadow: 0 24px 64px -16px rgb(0 0 0 / 0.7);
    --aurora-opacity: 0.55;
    color-scheme: dark;
  }
}

@theme {
  --font-sans: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono Variable', ui-monospace, monospace;
  --color-paper: var(--paper);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-action: var(--action);
  --color-action-ink: var(--action-ink);
  --color-glow: var(--glow);
  --color-fresh: var(--fresh);
  --color-aging: var(--aging);
  --color-dormant: var(--dormant);
  --color-danger: var(--danger);
  --color-chart: var(--chart);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-card: var(--card-shadow);
  --shadow-pop: var(--pop-shadow);
}

body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

::selection {
  background: var(--glow);
}

:focus-visible {
  outline: 2px solid var(--action);
  outline-offset: 2px;
}

@layer components {
  .field {
    @apply w-full min-w-0 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink shadow-card transition-colors placeholder:text-muted hover:border-line-strong focus:border-action focus:ring-3 focus:ring-glow focus:outline-none;
  }
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink shadow-card transition-[background-color,border-color,transform] duration-150 select-none hover:border-line-strong hover:bg-surface active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50;
  }
  .btn-primary {
    @apply border-transparent bg-action text-action-ink shadow-[0_0_0_1px_var(--action),0_6px_20px_-6px_var(--action)] hover:border-transparent hover:bg-action hover:brightness-110;
  }
  .btn-ghost {
    @apply border-transparent bg-transparent shadow-none hover:border-transparent hover:bg-surface-2;
  }
  .btn-danger {
    @apply text-danger hover:border-danger/40;
  }
  .btn-sm {
    @apply gap-1.5 px-2 py-1 text-xs;
  }
  .select-fit {
    field-sizing: content;
  }
  .card {
    @apply rounded-lg border border-line bg-surface shadow-card;
  }
  .label {
    @apply text-xs font-medium tracking-wider text-muted uppercase;
  }
  .skeleton {
    @apply rounded-md bg-surface-2;
    background-image: linear-gradient(90deg, transparent, var(--line), transparent);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
}

/* Spotlight: a soft glow following the pointer (position set by UiCard via --x/--y). */
.spotlight::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  transition: opacity 200ms;
  background: radial-gradient(360px circle at var(--x, 50%) var(--y, 50%), var(--glow), transparent 45%);
}
.spotlight:hover::after {
  opacity: 1;
}

/* Border beam: a light segment running along the border of the parent (needs `relative`). */
.border-beam {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 1px solid transparent;
  pointer-events: none;
  mask:
    linear-gradient(transparent, transparent) padding-box,
    linear-gradient(#000, #000) border-box;
  mask-composite: intersect;
}
.border-beam::after {
  content: '';
  position: absolute;
  width: 96px;
  aspect-ratio: 1;
  background: linear-gradient(to left, var(--action), transparent);
  offset-path: rect(0 auto auto 0 round 12px);
  animation: border-beam 9s linear infinite;
}

/* Dot grid with a radial fade, plus an aurora glow whose strength comes from --aurora-opacity. */
.dot-grid {
  background-image: radial-gradient(var(--line-strong) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: radial-gradient(ellipse 70% 60% at 50% 0%, #000 30%, transparent 75%);
}
.dot-grid::before {
  content: '';
  position: absolute;
  inset: -10% 10% 40%;
  opacity: var(--aurora-opacity);
  background:
    radial-gradient(40% 50% at 30% 30%, rgb(124 124 255 / 0.35), transparent 70%),
    radial-gradient(35% 45% at 70% 20%, rgb(60 207 146 / 0.18), transparent 70%);
  filter: blur(40px);
  animation: aurora 18s ease-in-out infinite alternate;
}

@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@keyframes border-beam {
  to { offset-distance: 100%; }
}
@keyframes aurora {
  from { transform: translate3d(-4%, 0, 0) scale(1); }
  to { transform: translate3d(4%, 3%, 0) scale(1.08); }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
  .border-beam {
    display: none;
  }
}
```

- [ ] **Step 10: Verify the app still builds and looks sane**

Run: `npm run typecheck && npm test && npm run build:web`
Expected: all pass. The current pages now render with the new palette and fonts (layout unchanged).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json web/index.html web/src/style.css web/src/prefs.ts web/src/theme.ts tests/web-theme.test.ts
git commit -m "feat(web): new design tokens, Geist fonts, theme preference with pre-paint script"
```

---

### Task 2: Motion helpers and effects

**Files:**
- Create: `web/src/motion.ts`, `web/src/ui/effects/NumberTicker.vue`, `web/src/ui/effects/StaggerItem.vue`, `web/src/ui/effects/BorderBeam.vue`, `web/src/ui/effects/DotGrid.vue`
- Test: `tests/web-motion.test.ts`

**Interfaces:**
- Consumes: CSS classes `.border-beam`, `.dot-grid` (Task 1).
- Produces: `STAGGER_STEP = 0.03`, `STAGGER_CAP = 10`, `staggerDelay(index: number, reduced?: boolean): number` (seconds), `tween(from: number, to: number, progress: number): number`, `reducedMotion: Ref<boolean>`, `finePointer: boolean`. Components: `<NumberTicker :value="number" :format="(n: number) => string" :duration="ms?" />`, `<StaggerItem :index="i" as="li">`, `<BorderBeam />`, `<DotGrid />`.

- [ ] **Step 1: Write the failing tests**

`tests/web-motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STAGGER_CAP, STAGGER_STEP, staggerDelay, tween } from '../web/src/motion'

describe('staggerDelay', () => {
  it('steps per item', () => {
    expect(staggerDelay(0)).toBe(0)
    expect(staggerDelay(3)).toBeCloseTo(3 * STAGGER_STEP)
  })

  it('is capped so long lists do not wait', () => {
    expect(staggerDelay(200)).toBeCloseTo(STAGGER_CAP * STAGGER_STEP)
    expect(staggerDelay(200)).toBeLessThan(0.5)
  })

  it('is zero with reduced motion and for negative indexes', () => {
    expect(staggerDelay(5, true)).toBe(0)
    expect(staggerDelay(-1)).toBe(0)
  })
})

describe('tween', () => {
  it('starts, ends and eases out', () => {
    expect(tween(0, 100, 0)).toBe(0)
    expect(tween(0, 100, 1)).toBe(100)
    expect(tween(0, 100, 0.5)).toBeGreaterThan(50)
  })

  it('clamps progress and works downwards', () => {
    expect(tween(10, 20, 2)).toBe(20)
    expect(tween(10, 20, -1)).toBe(10)
    expect(tween(100, 0, 1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web-motion.test.ts`
Expected: FAIL — cannot resolve `../web/src/motion`.

- [ ] **Step 3: Implement `web/src/motion.ts`**

```ts
import { ref } from 'vue'

export const STAGGER_STEP = 0.03
/** Items past this index enter together, so long lists don't wait. */
export const STAGGER_CAP = 10

/** Entrance delay in seconds for the i-th item of a list. */
export function staggerDelay(index: number, reduced = false): number {
  if (reduced) return 0
  return Math.min(Math.max(index, 0), STAGGER_CAP) * STAGGER_STEP
}

/** Value between `from` and `to` at `progress` (0..1, clamped), ease-out cubic. */
export function tween(from: number, to: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return from + (to - from) * (1 - (1 - p) ** 3)
}

const media = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null)

const reducedQuery = media('(prefers-reduced-motion: reduce)')
export const reducedMotion = ref(reducedQuery?.matches ?? false)
reducedQuery?.addEventListener('change', (e) => (reducedMotion.value = e.matches))

/** Pointer-following effects only make sense with a mouse or trackpad. */
export const finePointer = media('(pointer: fine)')?.matches ?? false
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/web-motion.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create `web/src/ui/effects/NumberTicker.vue`**

```vue
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { reducedMotion, tween } from '../../motion'

// `format` receives non-integer values while counting: round inside it when needed.
const props = withDefaults(defineProps<{ value: number; format?: (n: number) => string; duration?: number }>(), {
  format: (n: number) => String(Math.round(n)),
  duration: 600,
})

const shown = ref(reducedMotion.value ? props.value : 0)
let frame = 0

watch(
  () => props.value,
  (to) => {
    cancelAnimationFrame(frame)
    if (reducedMotion.value) {
      shown.value = to
      return
    }
    const from = shown.value
    const start = performance.now()
    const step = (now: number) => {
      const progress = (now - start) / props.duration
      shown.value = progress >= 1 ? to : tween(from, to, progress)
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  },
  { immediate: true },
)

onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <span class="tabular-nums" :aria-label="format(value)"><span aria-hidden="true">{{ format(shown) }}</span></span>
</template>
```

- [ ] **Step 6: Create `web/src/ui/effects/StaggerItem.vue`**

```vue
<script setup lang="ts">
import { Motion } from 'motion-v'
import { reducedMotion, staggerDelay } from '../../motion'

defineProps<{ index: number; as?: string }>()
</script>

<template>
  <Motion
    :as="as ?? 'div'"
    :initial="reducedMotion ? false : { opacity: 0, y: 6 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.25, ease: 'easeOut', delay: staggerDelay(index, reducedMotion) }"
  >
    <slot />
  </Motion>
</template>
```

- [ ] **Step 7: Create `web/src/ui/effects/BorderBeam.vue` and `DotGrid.vue`**

```vue
<!-- BorderBeam.vue: place inside a `relative` rounded element. -->
<script setup lang="ts">
import { finePointer, reducedMotion } from '../../motion'
</script>

<template>
  <div v-if="finePointer && !reducedMotion" class="border-beam" aria-hidden="true" />
</template>
```

```vue
<!-- DotGrid.vue: decorative page background; the parent must be `relative isolate`. -->
<template>
  <div class="dot-grid pointer-events-none absolute inset-x-0 -top-6 -z-10 h-[460px]" aria-hidden="true" />
</template>
```

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck && npx vitest run tests/web-motion.test.ts`
Expected: pass.

```bash
git add web/src/motion.ts web/src/ui/effects tests/web-motion.test.ts
git commit -m "feat(web): motion helpers, number ticker, stagger, border beam and dot grid effects"
```

---

### Task 3: UI components and toasts

**Files:**
- Create: `web/src/toasts.ts`, `web/src/ui/UiButton.vue`, `UiCard.vue`, `UiBadge.vue`, `UiStat.vue`, `UiEmpty.vue`, `UiSkeleton.vue`, `UiKbd.vue`, `PageHeader.vue`, `UiToastStack.vue`
- Test: `tests/web-toasts.test.ts`

**Interfaces:**
- Consumes: `.btn*`, `.card`, `.spotlight`, `.skeleton`, `.label` (Task 1); `finePointer`, `reducedMotion` (Task 2); `NumberTicker` (Task 2).
- Produces:
  - `toasts: Ref<Toast[]>`, `pushToast(message: string, tone?: 'info' | 'error', ttl?: number): number`, `dismissToast(id: number): void`, `interface Toast { id: number; tone: 'info' | 'error'; message: string }`, `MAX_TOASTS = 4`.
  - `<UiButton variant="primary|secondary|ghost|danger" size="sm|md" :icon="LucideComponent?" :to="RouteLocationRaw?" type="button|submit">` — renders `RouterLink` when `to` is set.
  - `<UiCard :spotlight="bool" as="section|div|li">`
  - `<UiBadge tone="neutral|accent|fresh|aging|dormant|danger">`
  - `<UiStat :label="string" :value="number" :format="fn" tone="default|danger|fresh" :hint="string?">`
  - `<UiEmpty :icon="LucideComponent" :title="string" :hint="string?">` + default slot for actions
  - `<UiSkeleton class="h-.. w-..">`, `<UiKbd>⌘K</UiKbd>`
  - `<PageHeader :title="string" :subtitle="string?">` + `actions` slot
  - `<UiToastStack />` (renders `toasts`)

- [ ] **Step 1: Write the failing toast tests**

`tests/web-toasts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TOASTS, dismissToast, pushToast, toasts } from '../web/src/toasts'

beforeEach(() => {
  vi.useFakeTimers()
  for (const t of [...toasts.value]) dismissToast(t.id)
})
afterEach(() => vi.useRealTimers())

describe('toasts', () => {
  it('auto-dismisses info toasts', () => {
    pushToast('Scan finished', 'info', 1000)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })

  it('keeps errors until dismissed', () => {
    const id = pushToast('Offline', 'error')
    vi.advanceTimersByTime(60_000)
    expect(toasts.value.map((t) => t.id)).toEqual([id])
    dismissToast(id)
    expect(toasts.value).toHaveLength(0)
  })

  it('replaces a toast with the same message', () => {
    pushToast('Offline', 'error')
    pushToast('Offline', 'error')
    expect(toasts.value).toHaveLength(1)
  })

  it('drops the oldest beyond the limit', () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) pushToast(`m${i}`, 'error')
    expect(toasts.value).toHaveLength(MAX_TOASTS)
    expect(toasts.value[0].message).toBe('m2')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web-toasts.test.ts`
Expected: FAIL — cannot resolve `../web/src/toasts`.

- [ ] **Step 3: Implement `web/src/toasts.ts`**

```ts
import { ref } from 'vue'

export type ToastTone = 'info' | 'error'
export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

export const MAX_TOASTS = 4
export const toasts = ref<Toast[]>([])

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/** Info toasts close after `ttl` ms; errors stay until dismissed. A repeated message replaces the old toast. */
export function pushToast(message: string, tone: ToastTone = 'info', ttl = 5000): number {
  for (const t of toasts.value.filter((t) => t.message === message)) dismissToast(t.id)
  const id = nextId++
  toasts.value = [...toasts.value, { id, tone, message }]
  if (tone === 'info') timers.set(id, setTimeout(() => dismissToast(id), ttl))
  while (toasts.value.length > MAX_TOASTS) dismissToast(toasts.value[0].id)
  return id
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/web-toasts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the components**

`web/src/ui/UiButton.vue`:

```vue
<script setup lang="ts">
import { computed, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    icon?: Component
    to?: RouteLocationRaw
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)

const classes = computed(() => [
  'btn',
  { 'btn-primary': props.variant === 'primary', 'btn-ghost': props.variant === 'ghost', 'btn-danger': props.variant === 'danger', 'btn-sm': props.size === 'sm' },
])
</script>

<template>
  <RouterLink v-if="to" :to="to" :class="classes">
    <component :is="icon" v-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <slot />
  </RouterLink>
  <button v-else :type="type" :class="classes">
    <component :is="icon" v-if="icon" class="size-4 shrink-0" aria-hidden="true" />
    <slot />
  </button>
</template>
```

`web/src/ui/UiCard.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { finePointer, reducedMotion } from '../motion'

const props = defineProps<{ spotlight?: boolean; as?: string }>()
const el = ref<HTMLElement | null>(null)
const lit = computed(() => !!props.spotlight && finePointer && !reducedMotion.value)

function move(e: PointerEvent) {
  if (!lit.value || !el.value) return
  const r = el.value.getBoundingClientRect()
  el.value.style.setProperty('--x', `${e.clientX - r.left}px`)
  el.value.style.setProperty('--y', `${e.clientY - r.top}px`)
}
</script>

<template>
  <component :is="as ?? 'div'" ref="el" class="card relative" :class="{ spotlight: lit }" @pointermove="move">
    <slot />
  </component>
</template>
```

`web/src/ui/UiBadge.vue`:

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{ tone?: 'neutral' | 'accent' | 'fresh' | 'aging' | 'dormant' | 'danger' }>(), { tone: 'neutral' })

const tones: Record<string, string> = {
  neutral: 'border-line text-muted',
  accent: 'border-action/30 bg-action/10 text-action',
  fresh: 'border-fresh/30 bg-fresh/10 text-fresh',
  aging: 'border-aging/30 bg-aging/10 text-aging',
  dormant: 'border-dormant/30 bg-dormant/10 text-dormant',
  danger: 'border-danger/30 bg-danger/10 text-danger',
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap" :class="tones[props.tone]">
    <slot />
  </span>
</template>
```

`web/src/ui/UiStat.vue`:

```vue
<script setup lang="ts">
import NumberTicker from './effects/NumberTicker.vue'

withDefaults(defineProps<{ label: string; value: number; format?: (n: number) => string; tone?: 'default' | 'danger' | 'fresh'; hint?: string }>(), {
  tone: 'default',
})
</script>

<template>
  <div :title="hint">
    <dt class="label">{{ label }}</dt>
    <dd class="mt-1.5 font-mono text-2xl font-medium tracking-tight" :class="{ 'text-danger': tone === 'danger', 'text-fresh': tone === 'fresh' }">
      <NumberTicker :value="value" :format="format" />
    </dd>
  </div>
</template>
```

Note for `UiStat`/`NumberTicker`: when `format` is omitted, `NumberTicker`'s default is used — pass `format` only when defined (Vue treats an `undefined` prop as absent, so the default applies).

`web/src/ui/UiEmpty.vue`:

```vue
<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ icon: Component; title: string; hint?: string }>()
</script>

<template>
  <div class="card flex flex-col items-center px-6 py-14 text-center">
    <div class="mb-4 grid size-11 place-items-center rounded-lg border border-line bg-surface-2 text-muted shadow-card">
      <component :is="icon" class="size-5" aria-hidden="true" />
    </div>
    <p class="font-medium">{{ title }}</p>
    <p v-if="hint" class="mt-1 max-w-sm text-sm text-muted">{{ hint }}</p>
    <div v-if="$slots.default" class="mt-5 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
```

`web/src/ui/UiSkeleton.vue`:

```vue
<template>
  <div class="skeleton" aria-hidden="true" />
</template>
```

`web/src/ui/UiKbd.vue`:

```vue
<template>
  <kbd class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-mono text-[11px] text-muted">
    <slot />
  </kbd>
</template>
```

`web/src/ui/PageHeader.vue`:

```vue
<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <slot name="before" />
      <h1 class="truncate text-2xl font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="subtitle" class="mt-1 text-sm text-muted">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2"><slot name="actions" /></div>
  </header>
</template>
```

`web/src/ui/UiToastStack.vue`:

```vue
<script setup lang="ts">
import { AnimatePresence, Motion } from 'motion-v'
import { CircleAlert, CircleCheck, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { dismissToast, toasts } from '../toasts'

const { t } = useI18n()
</script>

<template>
  <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
    <AnimatePresence>
      <Motion
        v-for="toast in toasts"
        :key="toast.id"
        layout
        :initial="{ opacity: 0, y: 12, scale: 0.98 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :exit="{ opacity: 0, scale: 0.98 }"
        :transition="{ type: 'spring', stiffness: 420, damping: 32 }"
        class="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm shadow-pop"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
      >
        <CircleAlert v-if="toast.tone === 'error'" class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <CircleCheck v-else class="mt-0.5 size-4 shrink-0 text-fresh" aria-hidden="true" />
        <p class="min-w-0 flex-1 break-words">{{ toast.message }}</p>
        <button class="-m-1 rounded p-1 text-muted hover:text-ink" :aria-label="t('ui.dismiss')" @click="dismissToast(toast.id)">
          <X class="size-4" aria-hidden="true" />
        </button>
      </Motion>
    </AnimatePresence>
  </div>
</template>
```

- [ ] **Step 6: Add the `ui` strings**

In `web/src/locales/en.json` add a top-level `"ui"` object (after `"a11y"`):

```json
"ui": {
  "dismiss": "Dismiss",
  "search": "Search",
  "collapse": "Collapse sidebar",
  "expand": "Expand sidebar",
  "menu": "Menu",
  "closeMenu": "Close menu"
}
```

In `web/src/locales/it.json`:

```json
"ui": {
  "dismiss": "Chiudi",
  "search": "Cerca",
  "collapse": "Comprimi barra laterale",
  "expand": "Espandi barra laterale",
  "menu": "Menu",
  "closeMenu": "Chiudi menu"
}
```

- [ ] **Step 7: Typecheck, test, commit**

Run: `npm run typecheck && npm test`
Expected: pass (including `tests/locales.test.ts`).

```bash
git add web/src/toasts.ts web/src/ui web/src/locales tests/web-toasts.test.ts
git commit -m "feat(web): base UI components and toast store"
```

---

### Task 4: Command palette logic

**Files:**
- Create: `web/src/palette.ts`
- Test: `tests/web-palette.test.ts`

**Interfaces:**
- Produces: `type PaletteGroup = 'pages' | 'projects' | 'tasks' | 'clients' | 'actions'`, `interface PaletteItem { id: string; group: PaletteGroup; label: string; hint?: string; keywords?: string }`, `GROUP_ORDER`, `MAX_PER_GROUP = 8`, `normalize(s)`, `fuzzyScore(query, text): number | null`, `searchPalette(items, query): { group: PaletteGroup; items: PaletteItem[] }[]`, `isPaletteShortcut(e): boolean`.

- [ ] **Step 1: Write the failing tests**

`tests/web-palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_PER_GROUP, fuzzyScore, isPaletteShortcut, searchPalette, type PaletteItem } from '../web/src/palette'

const item = (group: PaletteItem['group'], label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id: `${group}:${label}`, group, label, ...extra })

describe('fuzzyScore', () => {
  it('ranks prefix > word start > contains > subsequence', () => {
    const prefix = fuzzyScore('man', 'manage_my_projects')!
    const word = fuzzyScore('man', 'my manager')!
    const contains = fuzzyScore('man', 'woman')!
    const subseq = fuzzyScore('mmp', 'manage my projects')!
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(contains)
    expect(contains).toBeGreaterThan(subseq)
  })

  it('returns null when letters are missing or out of order', () => {
    expect(fuzzyScore('xyz', 'manage')).toBeNull()
    expect(fuzzyScore('pm', 'mp')).toBeNull()
  })

  it('ignores case and accents', () => {
    expect(fuzzyScore('CITTA', 'Città di Padova')).not.toBeNull()
    expect(fuzzyScore('città', 'CITTA')).not.toBeNull()
  })

  it('does not choke on regex characters', () => {
    expect(() => fuzzyScore('(', 'a (b)')).not.toThrow()
    expect(fuzzyScore('c++', 'Learn C++ fast')).not.toBeNull()
    expect(fuzzyScore('[', 'abc')).toBeNull()
  })
})

describe('searchPalette', () => {
  const items = [
    item('pages', 'Projects'),
    item('pages', 'Tasks'),
    item('actions', 'Rescan'),
    item('projects', 'shop-frontend', { hint: 'Acme' }),
    item('projects', 'shop-backend'),
    item('clients', 'Acme', { keywords: 'acme spa' }),
  ]

  it('shows only pages and actions for an empty query', () => {
    expect(searchPalette(items, '  ').map((g) => g.group)).toEqual(['pages', 'actions'])
  })

  it('filters every group and keeps group order', () => {
    const groups = searchPalette(items, 'shop')
    expect(groups.map((g) => g.group)).toEqual(['projects'])
    expect(groups[0].items.map((i) => i.label)).toEqual(['shop-backend', 'shop-frontend'])
  })

  it('matches keywords', () => {
    const clients = searchPalette(items, 'spa').find((g) => g.group === 'clients')
    expect(clients?.items[0].label).toBe('Acme')
  })

  it('caps each group', () => {
    const many = Array.from({ length: 30 }, (_, i) => item('projects', `proj-${i}`))
    expect(searchPalette(many, 'proj')[0].items).toHaveLength(MAX_PER_GROUP)
  })
})

describe('isPaletteShortcut', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
  })

  it('accepts Ctrl+K and Cmd+K in any case', () => {
    expect(isPaletteShortcut(key('k', { ctrlKey: true }))).toBe(true)
    expect(isPaletteShortcut(key('K', { metaKey: true }))).toBe(true)
  })

  it('rejects plain K and extra modifiers', () => {
    expect(isPaletteShortcut(key('k'))).toBe(false)
    expect(isPaletteShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isPaletteShortcut(key('k', { ctrlKey: true, altKey: true }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web-palette.test.ts`
Expected: FAIL — cannot resolve `../web/src/palette`.

- [ ] **Step 3: Implement `web/src/palette.ts`**

```ts
export type PaletteGroup = 'pages' | 'projects' | 'tasks' | 'clients' | 'actions'

export interface PaletteItem {
  /** Unique, e.g. "project:<uuid>"; the palette component maps it to an action. */
  id: string
  group: PaletteGroup
  label: string
  /** Secondary text shown at the right (client, project…). */
  hint?: string
  /** Extra searchable text, ranked just below the label. */
  keywords?: string
}

export const GROUP_ORDER: PaletteGroup[] = ['pages', 'projects', 'tasks', 'clients', 'actions']
export const MAX_PER_GROUP = 8
/** Shown without a query, so the palette is useful as a launcher. */
const ALWAYS_SHOWN: PaletteGroup[] = ['pages', 'actions']

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const BOUNDARY = /[\s\-_/.]/

/** Higher is better; null when `query` letters don't appear in order in `text`. Plain string ops, no regex from input. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query.trim())
  const s = normalize(text)
  if (!q) return 0
  const at = s.indexOf(q)
  if (at === 0) return 30_000 - Math.min(s.length, 9_999)
  if (at > 0) return (BOUNDARY.test(s[at - 1]) ? 20_000 : 10_000) - Math.min(at, 9_999)
  let from = 0
  let gaps = 0
  for (const ch of q) {
    const i = s.indexOf(ch, from)
    if (i === -1) return null
    gaps += i - from
    from = i + 1
  }
  return 5_000 - Math.min(gaps, 4_999)
}

function score(item: PaletteItem, query: string): number | null {
  const label = fuzzyScore(query, item.label)
  const keywords = item.keywords ? fuzzyScore(query, item.keywords) : null
  if (label === null && keywords === null) return null
  return Math.max(label ?? -Infinity, keywords === null ? -Infinity : keywords - 1)
}

export function searchPalette(items: PaletteItem[], query: string): { group: PaletteGroup; items: PaletteItem[] }[] {
  const q = query.trim()
  return GROUP_ORDER.map((group) => {
    const pool = items.filter((i) => i.group === group)
    if (!q) return { group, items: ALWAYS_SHOWN.includes(group) ? pool.slice(0, MAX_PER_GROUP) : [] }
    const ranked = pool
      .map((item) => ({ item, s: score(item, q) }))
      .filter((x): x is { item: PaletteItem; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s || a.item.label.localeCompare(b.item.label))
    return { group, items: ranked.slice(0, MAX_PER_GROUP).map((x) => x.item) }
  }).filter((g) => g.items.length)
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

export function isPaletteShortcut(e: KeyLike): boolean {
  return e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/web-palette.test.ts`
Expected: PASS (10 tests). If `shop-backend`/`shop-frontend` order differs, check the tie-break: both are prefix matches; shorter label wins (`30_000 - length`), and `shop-backend` (12) is shorter than `shop-frontend` (13).

- [ ] **Step 5: Commit**

```bash
git add web/src/palette.ts tests/web-palette.test.ts
git commit -m "feat(web): command palette fuzzy search and shortcut detection"
```

---

### Task 5: App shell — sidebar, page transition, toasts

**Files:**
- Create: `web/src/components/AppSidebar.vue`
- Modify: `web/src/App.vue`, `web/src/locales/en.json`, `web/src/locales/it.json`

**Interfaces:**
- Consumes: `readPref`/`writePref` (Task 1), `pushToast` + `UiToastStack` (Task 3), `UiKbd` (Task 3), `reducedMotion` (Task 2).
- Produces: `AppSidebar` props `{ links: NavLink[]; collapsed: boolean; scanning: boolean }`, emits `toggle`, `rescan`, `search`, `navigate`; `interface NavLink { to: string; label: string; icon: Component; active: (path: string) => boolean }` exported from `AppSidebar.vue` via a `<script lang="ts">` block. `App.vue` exposes `paletteOpen: Ref<boolean>` for Task 6 (local state, opened by `search` event and Ctrl/Cmd+K).

- [ ] **Step 1: Create `web/src/components/AppSidebar.vue`**

```vue
<script lang="ts">
import type { Component } from 'vue'

export interface NavLink {
  to: string
  label: string
  icon: Component
  active: (path: string) => boolean
}
</script>

<script setup lang="ts">
import { Motion } from 'motion-v'
import { PanelLeftClose, PanelLeftOpen, RefreshCw, Search } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import UiKbd from '../ui/UiKbd.vue'

defineProps<{ links: NavLink[]; collapsed: boolean; scanning: boolean }>()
const emit = defineEmits<{ toggle: []; rescan: []; search: []; navigate: [] }>()
const { t } = useI18n()
const route = useRoute()
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
</script>

<template>
  <div class="flex h-full flex-col gap-1 p-3">
    <div class="mb-3 flex items-center gap-2 px-1.5" :class="collapsed ? 'justify-center' : 'justify-between'">
      <RouterLink to="/" class="flex items-center gap-2 text-[15px] font-semibold tracking-tight" @click="emit('navigate')">
        <img src="/favicon.svg" alt="" class="size-6" />
        <span v-if="!collapsed">mmp</span>
      </RouterLink>
      <button v-if="!collapsed" class="hidden rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink md:block" :aria-label="t('ui.collapse')" @click="emit('toggle')">
        <PanelLeftClose class="size-4" aria-hidden="true" />
      </button>
    </div>

    <button
      class="mb-2 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-muted shadow-card hover:border-line-strong hover:text-ink"
      :class="{ 'justify-center px-0': collapsed }"
      :aria-label="t('ui.search')"
      @click="emit('search')"
    >
      <Search class="size-4 shrink-0" aria-hidden="true" />
      <template v-if="!collapsed">
        <span class="flex-1 text-left">{{ t('ui.search') }}</span>
        <UiKbd>{{ isMac ? '⌘' : 'Ctrl' }} K</UiKbd>
      </template>
    </button>

    <nav class="flex flex-col gap-0.5">
      <RouterLink
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors"
        :class="[link.active(route.path) ? 'text-ink' : 'text-muted hover:text-ink', { 'justify-center px-0': collapsed }]"
        :title="collapsed ? link.label : undefined"
        @click="emit('navigate')"
      >
        <Motion
          v-if="link.active(route.path)"
          layout-id="nav-active"
          class="absolute inset-0 rounded-md border border-line bg-surface-2 shadow-card"
          :transition="{ type: 'spring', stiffness: 500, damping: 38 }"
        />
        <component :is="link.icon" class="relative size-4 shrink-0" aria-hidden="true" />
        <span v-if="!collapsed" class="relative truncate">{{ link.label }}</span>
      </RouterLink>
    </nav>

    <div class="mt-auto flex flex-col gap-1">
      <button v-if="collapsed" class="hidden justify-center rounded-md p-2 text-muted hover:bg-surface-2 hover:text-ink md:flex" :aria-label="t('ui.expand')" @click="emit('toggle')">
        <PanelLeftOpen class="size-4" aria-hidden="true" />
      </button>
      <button class="btn w-full" :class="{ 'px-0': collapsed }" :disabled="scanning" :title="collapsed ? t('app.rescan') : undefined" @click="emit('rescan')">
        <RefreshCw class="size-4" :class="{ 'animate-spin': scanning }" aria-hidden="true" />
        <span v-if="!collapsed">{{ scanning ? t('app.scanning') : t('app.rescan') }}</span>
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Rewrite `web/src/App.vue`**

```vue
<script setup lang="ts">
import { AnimatePresence, Motion, MotionConfig } from 'motion-v'
import { CheckSquare, Clock, FolderGit2, LayoutDashboard, Menu, Settings, Users, Wallet } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { api } from './api'
import AppSidebar, { type NavLink } from './components/AppSidebar.vue'
import { scanTick, useErrors } from './composables'
import { isPaletteShortcut } from './palette'
import { readPref, writePref } from './prefs'
import { pushToast } from './toasts'
import UiKbd from './ui/UiKbd.vue'
import UiToastStack from './ui/UiToastStack.vue'

const { t } = useI18n()
const route = useRoute()
const links = computed<NavLink[]>(() => [
  { to: '/', label: t('app.overview'), icon: LayoutDashboard, active: (p) => p === '/' },
  { to: '/projects', label: t('app.projects'), icon: FolderGit2, active: (p) => p.startsWith('/projects') },
  { to: '/tasks', label: t('app.tasks'), icon: CheckSquare, active: (p) => p.startsWith('/tasks') },
  { to: '/time', label: t('app.time'), icon: Clock, active: (p) => p.startsWith('/time') },
  { to: '/finance', label: t('app.finance'), icon: Wallet, active: (p) => p.startsWith('/finance') },
  { to: '/clients', label: t('app.clients'), icon: Users, active: (p) => p.startsWith('/clients') },
  { to: '/settings', label: t('app.settings'), icon: Settings, active: (p) => p.startsWith('/settings') },
])

const SIDEBAR_KEY = 'mmp.sidebar'
const collapsed = ref(readPref(SIDEBAR_KEY) === 'collapsed')
function toggleSidebar() {
  collapsed.value = !collapsed.value
  writePref(SIDEBAR_KEY, collapsed.value ? 'collapsed' : null)
}

const drawerOpen = ref(false)
const paletteOpen = ref(false)

const scanning = ref(false)
const { error, report, clear } = useErrors()
async function rescan() {
  scanning.value = true
  clear()
  try {
    const r = await api.scan()
    pushToast(t('app.scanDone', { added: r.added, missing: r.missing, total: r.total }))
    scanTick.value++
  } catch (e) {
    report(e)
    if (error.value) pushToast(error.value, 'error')
  } finally {
    scanning.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (isPaletteShortcut(e)) {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  } else if (e.key === 'Escape' && drawerOpen.value) {
    drawerOpen.value = false
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div class="min-h-screen md:flex">
      <!-- Desktop sidebar -->
      <aside
        class="sticky top-0 hidden h-screen shrink-0 border-r border-line bg-paper transition-[width] duration-200 md:block"
        :class="collapsed ? 'w-14' : 'w-60'"
      >
        <AppSidebar :links="links" :collapsed="collapsed" :scanning="scanning" @toggle="toggleSidebar" @rescan="rescan" @search="paletteOpen = true" />
      </aside>

      <!-- Mobile drawer -->
      <AnimatePresence>
        <Motion
          v-if="drawerOpen"
          class="fixed inset-0 z-40 bg-black/50 md:hidden"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :exit="{ opacity: 0 }"
          @click="drawerOpen = false"
        />
        <Motion
          v-if="drawerOpen"
          as="aside"
          class="fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-paper shadow-pop md:hidden"
          :initial="{ x: -280 }"
          :animate="{ x: 0 }"
          :exit="{ x: -280 }"
          :transition="{ type: 'spring', stiffness: 380, damping: 36 }"
        >
          <AppSidebar :links="links" :collapsed="false" :scanning="scanning" @rescan="rescan" @search="drawerOpen = false; paletteOpen = true" @navigate="drawerOpen = false" />
        </Motion>
      </AnimatePresence>

      <div class="min-w-0 flex-1">
        <div class="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/80 px-4 py-2.5 backdrop-blur md:hidden">
          <button class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" :aria-label="t('ui.menu')" @click="drawerOpen = true">
            <Menu class="size-5" aria-hidden="true" />
          </button>
          <span class="font-semibold tracking-tight">mmp</span>
          <button class="ml-auto flex items-center gap-1.5 text-sm text-muted" :aria-label="t('ui.search')" @click="paletteOpen = true">
            <UiKbd>Ctrl K</UiKbd>
          </button>
        </div>

        <main class="relative isolate mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <RouterView v-slot="{ Component }">
            <AnimatePresence mode="wait">
              <Motion
                :key="route.path"
                :initial="{ opacity: 0, y: 4 }"
                :animate="{ opacity: 1, y: 0 }"
                :exit="{ opacity: 0, y: -4 }"
                :transition="{ duration: 0.18, ease: 'easeOut' }"
              >
                <component :is="Component" />
              </Motion>
            </AnimatePresence>
          </RouterView>
        </main>
      </div>
    </div>
    <UiToastStack />
  </MotionConfig>
</template>
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run build` then `npm start` (or `npm run dev:web` with `mmp start` running).
Check: sidebar renders with icons; active pill slides when changing page; collapse button shrinks to icons and survives reload; under 768px the menu button opens the drawer, Esc and backdrop close it; Rescan shows a toast that disappears after 5 s; page transitions fade.

- [ ] **Step 4: Typecheck, test, commit**

Run: `npm run typecheck && npm test`

```bash
git add web/src/App.vue web/src/components/AppSidebar.vue
git commit -m "feat(web): sidebar layout with mobile drawer, page transitions and toasts"
```

---

### Task 6: Command palette component

**Files:**
- Create: `web/src/components/CommandPalette.vue`
- Modify: `web/src/App.vue`, `web/src/locales/en.json`, `web/src/locales/it.json`

**Interfaces:**
- Consumes: `searchPalette`, `PaletteItem`, `PaletteGroup` (Task 4); `setThemePreference`, `THEME_PREFERENCES` (Task 1); `NavLink` (Task 5); `api.projects`, `api.tasks`, `api.clients`; `scanTick`.
- Produces: `<CommandPalette :open="boolean" :links="NavLink[]" @close @rescan />`.

- [ ] **Step 1: Add strings**

`en.json` → inside `"ui"` add:

```json
"palette": {
  "placeholder": "Search projects, tasks, clients…",
  "empty": "No results for “{query}”",
  "pages": "Pages",
  "projects": "Projects",
  "tasks": "Tasks",
  "clients": "Clients",
  "actions": "Actions",
  "themeSystem": "Theme: system",
  "themeLight": "Theme: light",
  "themeDark": "Theme: dark",
  "navigate": "to navigate",
  "select": "to select",
  "close": "to close"
}
```

`it.json` → inside `"ui"` add:

```json
"palette": {
  "placeholder": "Cerca progetti, task, clienti…",
  "empty": "Nessun risultato per “{query}”",
  "pages": "Pagine",
  "projects": "Progetti",
  "tasks": "Task",
  "clients": "Clienti",
  "actions": "Azioni",
  "themeSystem": "Tema: sistema",
  "themeLight": "Tema: chiaro",
  "themeDark": "Tema: scuro",
  "navigate": "per muoverti",
  "select": "per aprire",
  "close": "per chiudere"
}
```

- [ ] **Step 2: Create `web/src/components/CommandPalette.vue`**

```vue
<script setup lang="ts">
import { AnimatePresence, Motion } from 'motion-v'
import { CheckSquare, CornerDownLeft, FolderGit2, RefreshCw, Search, SunMoon, Users } from 'lucide-vue-next'
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { scanTick } from '../composables'
import { searchPalette, type PaletteGroup, type PaletteItem } from '../palette'
import { THEME_PREFERENCES, setThemePreference } from '../theme'
import UiKbd from '../ui/UiKbd.vue'
import type { NavLink } from './AppSidebar.vue'

const props = defineProps<{ open: boolean; links: NavLink[] }>()
const emit = defineEmits<{ close: []; rescan: [] }>()
const { t } = useI18n()
const router = useRouter()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const remote = ref<PaletteItem[]>([])
let loadedTick = -1
let returnFocus: HTMLElement | null = null

const groupIcon: Record<PaletteGroup, Component> = { pages: Search, projects: FolderGit2, tasks: CheckSquare, clients: Users, actions: SunMoon }

async function load() {
  if (loadedTick === scanTick.value) return
  try {
    const [projects, tasks, clients] = await Promise.all([api.projects({}), api.tasks({ status: 'todo,in_progress' }), api.clients()])
    loadedTick = scanTick.value
    remote.value = [
      ...projects.map((p) => ({ id: `project:${p.id}`, group: 'projects' as const, label: p.name, hint: p.client?.name, keywords: p.path })),
      ...tasks.map((x) => ({ id: `task:${x.id}:${x.project.id}`, group: 'tasks' as const, label: x.title, hint: x.project.name })),
      ...clients.map((c) => ({ id: `client:${c.id}`, group: 'clients' as const, label: c.name, keywords: c.email })),
    ]
  } catch {
    // Offline: pages and actions still work; retry on next open.
  }
}

const staticItems = computed<PaletteItem[]>(() => [
  ...props.links.map((l) => ({ id: `page:${l.to}`, group: 'pages' as const, label: l.label })),
  { id: 'action:rescan', group: 'actions' as const, label: t('app.rescan') },
  ...THEME_PREFERENCES.map((p) => ({ id: `theme:${p}`, group: 'actions' as const, label: t(`ui.palette.theme${p[0].toUpperCase()}${p.slice(1)}`) })),
])

const groups = computed(() => searchPalette([...staticItems.value, ...remote.value], query.value))
const flat = computed(() => groups.value.flatMap((g) => g.items))

watch(query, () => (active.value = 0))
watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null
      query.value = ''
      active.value = 0
      void load()
      await nextTick()
      input.value?.focus()
    } else {
      returnFocus?.focus?.()
    }
  },
)

function run(item: PaletteItem) {
  const [kind, id, extra] = item.id.split(':')
  if (kind === 'page') router.push(item.id.slice('page:'.length))
  else if (kind === 'project') router.push({ name: 'project', params: { id } })
  else if (kind === 'task') router.push({ name: 'project', params: { id: extra } })
  else if (kind === 'client') router.push({ name: 'client', params: { id } })
  else if (kind === 'action' && id === 'rescan') emit('rescan')
  else if (kind === 'theme') setThemePreference(id as (typeof THEME_PREFERENCES)[number])
  emit('close')
}

function onKey(e: KeyboardEvent) {
  const n = flat.value.length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (n) active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (n) active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = flat.value[active.value]
    if (item) run(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  } else if (e.key === 'Tab') {
    e.preventDefault() // focus stays in the search field
  }
}

watch(active, async (i) => {
  await nextTick()
  document.getElementById(`palette-item-${i}`)?.scrollIntoView({ block: 'nearest' })
})

</script>

<template>
  <AnimatePresence>
    <Motion
      v-if="open"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.15 }"
      @click="emit('close')"
    />
    <Motion
      v-if="open"
      class="fixed inset-x-4 top-[12vh] z-50 mx-auto max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop"
      role="dialog"
      aria-modal="true"
      :aria-label="t('ui.search')"
      :initial="{ opacity: 0, scale: 0.97, y: -8 }"
      :animate="{ opacity: 1, scale: 1, y: 0 }"
      :exit="{ opacity: 0, scale: 0.98 }"
      :transition="{ type: 'spring', stiffness: 500, damping: 36 }"
    >
      <div class="flex items-center gap-3 border-b border-line px-4">
        <Search class="size-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          class="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          :placeholder="t('ui.palette.placeholder')"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          :aria-activedescendant="flat.length ? `palette-item-${active}` : undefined"
          @keydown="onKey"
        />
        <UiKbd>Esc</UiKbd>
      </div>

      <div id="palette-list" class="max-h-[min(60vh,26rem)] overflow-y-auto p-2" role="listbox">
        <p v-if="!flat.length" class="px-3 py-8 text-center text-sm text-muted">{{ t('ui.palette.empty', { query }) }}</p>
        <section v-for="g in groups" :key="g.group" class="mb-1">
          <p class="label px-2.5 pt-2 pb-1">{{ t(`ui.palette.${g.group}`) }}</p>
          <button
            v-for="item in g.items"
            :id="`palette-item-${flat.indexOf(item)}`"
            :key="item.id"
            type="button"
            tabindex="-1"
            role="option"
            :aria-selected="flat.indexOf(item) === active"
            class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm"
            :class="flat.indexOf(item) === active ? 'bg-surface-2 text-ink' : 'text-muted'"
            @mousemove="active = flat.indexOf(item)"
            @click="run(item)"
          >
            <component :is="item.id === 'action:rescan' ? RefreshCw : groupIcon[g.group]" class="size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-ink">{{ item.label }}</span>
            <span v-if="item.hint" class="max-w-[40%] shrink-0 truncate text-xs">{{ item.hint }}</span>
            <CornerDownLeft v-if="flat.indexOf(item) === active" class="size-3.5 shrink-0" aria-hidden="true" />
          </button>
        </section>
      </div>

      <div class="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs text-muted sm:flex">
        <span class="flex items-center gap-1.5"><UiKbd>↑</UiKbd><UiKbd>↓</UiKbd> {{ t('ui.palette.navigate') }}</span>
        <span class="flex items-center gap-1.5"><UiKbd>↵</UiKbd> {{ t('ui.palette.select') }}</span>
        <span class="flex items-center gap-1.5"><UiKbd>Esc</UiKbd> {{ t('ui.palette.close') }}</span>
      </div>
    </Motion>
  </AnimatePresence>
</template>
```

- [ ] **Step 3: Mount it in `web/src/App.vue`**

Add the import `import CommandPalette from './components/CommandPalette.vue'` and, next to `<UiToastStack />`:

```vue
<CommandPalette :open="paletteOpen" :links="links" @close="paletteOpen = false" @rescan="rescan" />
```

- [ ] **Step 4: Verify in the browser (keyboard only)**

Check: Ctrl+K opens (also while focus is in a page input; Chrome's own Ctrl+K does not fire); typing filters with accents ignored; ↑/↓ wrap; Enter on a project/task/client navigates; Enter on "Theme: light" switches theme and it persists after reload; Esc closes and focus returns to the previously focused element; with the server stopped, pages and actions still appear.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npm run typecheck && npm test`

```bash
git add web/src/components/CommandPalette.vue web/src/App.vue web/src/locales
git commit -m "feat(web): Ctrl/Cmd+K command palette for pages, projects, tasks, clients and actions"
```

---

### Task 7: Appearance setting

**Files:**
- Create: `web/src/components/ThemeSettings.vue`
- Modify: `web/src/views/SettingsView.vue`, `web/src/locales/en.json`, `web/src/locales/it.json`

**Interfaces:**
- Consumes: `themePreference`, `setThemePreference`, `THEME_PREFERENCES` (Task 1).

- [ ] **Step 1: Add strings**

`en.json` → `"settings"`: `"appearance": "Appearance"`, `"appearanceHint": "Stored in this browser."`, `"themeSystem": "System"`, `"themeLight": "Light"`, `"themeDark": "Dark"`.
`it.json` → `"settings"`: `"appearance": "Aspetto"`, `"appearanceHint": "Salvato in questo browser."`, `"themeSystem": "Sistema"`, `"themeLight": "Chiaro"`, `"themeDark": "Scuro"`.

- [ ] **Step 2: Create `web/src/components/ThemeSettings.vue`**

```vue
<script setup lang="ts">
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { THEME_PREFERENCES, setThemePreference, themePreference, type ThemePreference } from '../theme'

const { t } = useI18n()
const icons = { system: Monitor, light: Sun, dark: Moon }
const label = (p: ThemePreference) => t(`settings.theme${p[0].toUpperCase()}${p.slice(1)}`)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('settings.appearance') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('settings.appearanceHint') }}</p>
    <div class="mt-3 inline-flex rounded-lg border border-line bg-surface-2 p-0.5" role="radiogroup" :aria-label="t('settings.appearance')">
      <button
        v-for="p in THEME_PREFERENCES"
        :key="p"
        type="button"
        role="radio"
        :aria-checked="themePreference === p"
        class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
        :class="themePreference === p ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
        @click="setThemePreference(p)"
      >
        <component :is="icons[p]" class="size-4" aria-hidden="true" />
        {{ label(p) }}
      </button>
    </div>
  </section>
</template>
```

- [ ] **Step 3: Mount it**

In `web/src/views/SettingsView.vue` import `ThemeSettings` and place `<ThemeSettings />` directly before `<LanguageSettings />`.

- [ ] **Step 4: Typecheck, test, commit**

Run: `npm run typecheck && npm test`

```bash
git add web/src/components/ThemeSettings.vue web/src/views/SettingsView.vue web/src/locales
git commit -m "feat(web): appearance setting (system, light, dark)"
```

---

## Migration recipe (applies to Tasks 8–10)

Logic in `<script setup>` stays as is; only imports and template markup change. Use these exact mappings:

| Before | After |
|---|---|
| `<div class="mb-6 flex … justify-between gap-3"><h1 class="text-2xl …">{{ X }}</h1> …actions…</div>` | `<PageHeader :title="X"><template #actions>…actions…</template></PageHeader>` |
| `<p v-if="error" class="… text-danger">{{ error }}</p>` | `<p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>` |
| `<ul class="divide-y divide-line border-y border-line …">` | `<UiCard as="ul" class="divide-y divide-line overflow-hidden …">` (keep other classes) |
| `<li v-for="(x, i) in list" …>` inside such a list | `<StaggerItem v-for="(x, i) in list" :index="i" as="li" …>` (add `i` to `v-for` if missing; keep `:key`) |
| Stat `<div><dt …>{{ L }}</dt><dd …>{{ format(v) }}</dd></div>` | `<UiStat :label="L" :value="v" :format="(n) => format(Math.round(n))" />` |
| `<h2 class="mb-3 text-sm font-semibold text-muted">` (section labels) | `<h2 class="label mb-3">` |
| Empty `<p … border-y border-line py-10 text-center …>{{ msg }}</p>` | `<UiEmpty :icon="IconForPage" :title="msg" />` |
| Empty block with title/hint/actions (Projects, Tasks) | `<UiEmpty :icon="…" :title="…" :hint="…"> …buttons… </UiEmpty>` |
| Inline pills `rounded border border-line px-1.5 text-xs text-muted` | `<UiBadge>` ; tags `#tag` → `<UiBadge tone="accent">#{{ tag }}</UiBadge>` |
| Horizontal bars `bg-line/50` track + `bg-chart` fill with `:style="{ width }"` | Track `h-1.5 rounded-full bg-surface-2`; fill `<Motion class="h-1.5 rounded-full bg-chart origin-left" :initial="{ scaleX: 0 }" :animate="{ scaleX: ratio }" :transition="{ duration: 0.6, ease: 'easeOut', delay: staggerDelay(i, reducedMotion) }" />` where the fill has `w-full` and `ratio` is the old width fraction (0..1) |
| Loading state (nothing shown while `data === null`) | Show 3 `<UiSkeleton class="h-24" />` in the same grid while `data === null && !error` |
| `<table>` | wrap in `<UiCard class="overflow-x-auto">`; `thead` row `text-xs text-muted uppercase tracking-wider`; rows `hover:bg-surface-2/60` |
| Warning glyphs `⚠` / `●` in text | Lucide `TriangleAlert` / `CircleDot` at `size-3.5` inside `UiBadge tone="aging"`/`"danger"` |

Icons for empty states: Projects `FolderGit2`, Tasks `CheckSquare`, Time `Clock`, Finance `Wallet`, Clients `Users`, Overview all-clear `PartyPopper`.

Never animate width/height: bars use `scaleX`, charts use `scaleY` or `pathLength`.

Each of Tasks 8–10 ends with: `npm run typecheck && npm test && npm run build:web`, a browser check of the touched pages in dark, light and 390 px width, and a commit.

---

### Task 8: Overview (showcase page)

**Files:**
- Modify: `web/src/views/OverviewView.vue`

**Interfaces:**
- Consumes: `PageHeader`, `UiCard`, `UiStat`, `UiEmpty`, `UiSkeleton`, `UiBadge` (Task 3); `StaggerItem`, `BorderBeam`, `DotGrid` (Task 2); `staggerDelay`, `reducedMotion` (Task 2).

- [ ] **Step 1: Template structure**

Replace the template with this structure (data bindings are the existing ones):

```vue
<template>
  <section class="relative isolate">
    <DotGrid />
    <PageHeader :title="t('app.overview')">
      <template #actions>
        <UiButton :icon="copied ? Check : ClipboardCopy" @click="copyDigest">{{ copied ? t('overview.copied') : t('overview.copyDigest') }}</UiButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div v-if="!data && !error" class="grid gap-4 lg:grid-cols-2">
      <UiSkeleton class="h-56" /><UiSkeleton class="h-56" />
    </div>

    <template v-if="data">
      <div class="grid gap-4 lg:grid-cols-2">
        <UiCard spotlight as="section" class="overflow-hidden p-5">
          <BorderBeam />
          <h2 class="label mb-4">{{ t('overview.thisWeek') }} <span class="ml-1 font-mono normal-case tracking-normal">{{ data.week.from }} → {{ data.week.to }}</span></h2>
          <dl class="grid grid-cols-3 gap-4">
            <UiStat :label="t('time.total')" :value="data.week.minutes" :format="(n) => formatMinutes(Math.round(n))" />
            <UiStat :label="t('time.aiCost')" :value="data.week.costUsd" :format="formatUsd" :hint="t('time.aiCostHint')" />
            <UiStat :label="t('overview.tasksDone')" :value="data.week.tasksCompleted" />
          </dl>
          <ul v-if="data.week.topProjects.length" class="mt-6 space-y-2.5 text-sm">
            <StaggerItem v-for="(p, i) in data.week.topProjects" :key="p.id" :index="i" as="li" class="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-3">
              <RouterLink :to="{ name: 'project', params: { id: p.id } }" class="truncate hover:text-action">{{ p.name }}</RouterLink>
              <div class="h-1.5 rounded-full bg-surface-2">
                <Motion class="h-1.5 w-full origin-left rounded-full bg-chart" :initial="{ scaleX: 0 }" :animate="{ scaleX: p.minutes / maxMinutes }" :transition="{ duration: 0.6, ease: 'easeOut', delay: staggerDelay(i, reducedMotion) }" />
              </div>
              <span class="text-right font-mono text-xs text-muted">{{ formatMinutes(p.minutes) }}</span>
            </StaggerItem>
          </ul>
        </UiCard>

        <UiCard spotlight as="section" class="p-5">
          <h2 class="label mb-4">{{ t('overview.thisMonth') }}</h2>
          <dl class="grid grid-cols-3 gap-4">
            <UiStat :label="t('finance.earned')" :value="data.month.earnedCents" :format="(n) => money(Math.round(n))" />
            <UiStat :label="t('finance.collected')" :value="data.month.collectedCents" :format="(n) => money(Math.round(n))" />
            <UiStat :label="t('finance.margin')" :value="data.month.marginCents" :format="(n) => money(Math.round(n))" :tone="data.month.marginCents < 0 ? 'danger' : 'default'" />
          </dl>
          <RouterLink to="/finance" class="mt-6 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">{{ t('overview.seeFinance') }} <ArrowRight class="size-3.5" aria-hidden="true" /></RouterLink>
        </UiCard>
      </div>

      <h2 class="mt-12 mb-4 text-lg font-semibold">{{ t('overview.attention') }}</h2>
      <UiEmpty v-if="allClear" :icon="PartyPopper" :title="t('overview.allClear')" />

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Each existing attention <section> becomes a UiCard (spotlight) with p-4,
             its <h3> keeps its text and colors, its <ul> drops `border-y border-line`
             and keeps `divide-y divide-line`, and each <li> becomes
             <StaggerItem :index="i" as="li"> with the existing classes and content. -->
      </div>
    </template>
  </section>
</template>
```

Fill in the four attention sections following the comment (overdue tasks, health, owed, upcoming), keeping every binding, `v-if`, `slice(0, 8)`, link and class exactly as today except: `<section>` → `<UiCard spotlight as="section" class="p-4">`, list borders as described, `li` → `StaggerItem` with `v-for="(x, i) in …"`, the overdue count and upcoming direction use `<UiBadge tone="danger">` / `<UiBadge tone="fresh">` for invoice.

- [ ] **Step 2: Script imports**

Add to `<script setup>`:

```ts
import { Motion } from 'motion-v'
import { ArrowRight, Check, ClipboardCopy, PartyPopper } from 'lucide-vue-next'
import { reducedMotion, staggerDelay } from '../motion'
import PageHeader from '../ui/PageHeader.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiSkeleton from '../ui/UiSkeleton.vue'
import UiStat from '../ui/UiStat.vue'
import BorderBeam from '../ui/effects/BorderBeam.vue'
import DotGrid from '../ui/effects/DotGrid.vue'
import StaggerItem from '../ui/effects/StaggerItem.vue'
```

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test && npm run build:web`. Browser: numbers count up once on load and do not re-animate on the 60 s auto-refresh when values are unchanged; bars grow; spotlight follows the mouse; beam runs around the week card; dot grid + aurora visible in dark, only dots in light; with OS "reduce motion" on, everything is static and final values show immediately.

```bash
git add web/src/views/OverviewView.vue
git commit -m "feat(web): redesigned overview with animated stats, spotlight cards and background"
```

---

### Task 9: Projects, project detail and their components

**Files:**
- Modify: `web/src/views/ProjectsView.vue`, `web/src/views/ProjectDetailView.vue`, `web/src/components/StatusMark.vue`, `FreshnessStrip.vue`, `CategoryDot.vue`, `TagEditor.vue`, `ProjectTasks.vue`, `ProjectTime.vue`, `ProjectMoney.vue`

- [ ] **Step 1: ProjectsView**

Apply the migration recipe. Specifics:
- Header: `<PageHeader :title="t('app.projects')" :subtitle="t('list.count', { n: sorted.length }, sorted.length)" />`.
- Search input gets a leading icon: wrap in `<div class="relative mb-2"><Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" /><input … class="field pl-9" … /></div>`.
- Filter selects keep `.field` (already restyled).
- The list becomes `<UiCard spotlight as="ul" class="divide-y divide-line overflow-hidden">`, rows `StaggerItem as="li"`, the `RouterLink` row class `hover:bg-surface-2/60 px-4` instead of `px-1 hover:bg-surface`.
- Stack pills → `<UiBadge>`; tags → `<UiBadge tone="accent">`; health flag → `<UiBadge tone="aging"><TriangleAlert class="size-3" aria-hidden="true" />{{ t(`health.${mainFlag(p)}`) }}</UiBadge>`; missing → `<UiBadge tone="danger">`; uncommitted → `<UiBadge tone="aging" :title="…"><CircleDot class="size-3" aria-hidden="true" />{{ t('list.uncommitted') }}</UiBadge>`.
- Empty state → `<UiEmpty :icon="FolderGit2" :title="t('list.emptyTitle')" :hint="t('list.emptyHint')">` with the two existing buttons as `UiButton` (`to="/settings"` for the settings one).
- Loading: while `!loaded && !error`, render `<UiCard class="divide-y divide-line"><div v-for="n in 6" :key="n" class="p-4"><UiSkeleton class="h-4 w-1/3" /><UiSkeleton class="mt-2 h-3 w-1/2" /></div></UiCard>`.

- [ ] **Step 2: StatusMark, FreshnessStrip, CategoryDot**

Read each file first. `StatusMark`: render through `UiBadge` with tone by status (active→`fresh`, paused→`aging`, archived/other→`dormant`; keep the existing label text). `FreshnessStrip`: track `h-1 rounded-full bg-surface-2`, marker a `size-2 rounded-full` dot colored by bucket with `ring-2 ring-surface`; keep the existing position math. `CategoryDot`: keep behavior, use `size-2 rounded-full` and add `ring-1 ring-line`.

- [ ] **Step 3: ProjectDetailView and panels**

Apply the recipe. Header uses `PageHeader` with the `before` slot for the back link (`← Projects` becomes `<ArrowLeft class="size-3.5" />` + text, `text-sm text-muted hover:text-ink`), title = project name, `actions` slot holds the existing open-folder / open-VS Code buttons as `UiButton` with icons `FolderOpen` and `Code`. Each panel (`ProjectTasks`, `ProjectTime`, `ProjectMoney`, the details/edit section, `TagEditor`) is wrapped in `<UiCard class="p-5">` with its heading as `<h2 class="label mb-4">`. Inside panels apply the same recipe (lists → divide-y without outer borders, stats → `UiStat`, buttons → `UiButton` or keep `.btn`).

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test && npm run build:web`. Browser: projects list with 100+ projects scrolls smoothly and the last rows appear without delay; filters still update the URL; project page actions work; dark/light/390 px.

```bash
git add web/src/views/ProjectsView.vue web/src/views/ProjectDetailView.vue web/src/components
git commit -m "feat(web): redesigned projects list and project page"
```

---

### Task 10: Tasks, Time, Finance, Clients, Settings

**Files:**
- Modify: `web/src/views/TasksView.vue`, `TimeView.vue`, `FinanceView.vue`, `ClientsView.vue`, `ClientDetailView.vue`, `SettingsView.vue`; `web/src/components/TaskItem.vue`, `DailyChart.vue`, `CommandReference.vue`, `CategoriesSettings.vue`, `FinanceSettings.vue`, `TimeSettings.vue`, `LanguageSettings.vue`

- [ ] **Step 1: Tasks + TaskItem**

Apply the recipe. Task groups are `UiCard` lists. In `TaskItem.vue` wrap the root element in `<Motion layout as="li" …>` (keep the root tag and classes; if the root is not `li`, use its tag) so completing/reordering animates; priority shown with `UiBadge` (urgent→`danger`, high→`aging`, others neutral); due dates in `font-mono text-xs`. Empty state `UiEmpty` with `CheckSquare`.

- [ ] **Step 2: Time + DailyChart**

Apply the recipe; stats via `UiStat` (minutes with `formatMinutes(Math.round(n))`, costs with `formatUsd`). In `DailyChart.vue` read the file first; animate each bar/rect with `motion-v`: for SVG rects use `<Motion as="rect" … :initial="{ scaleY: 0 }" :animate="{ scaleY: 1 }" :style="{ transformOrigin: 'bottom', transformBox: 'fill-box' }" :transition="{ duration: 0.5, ease: 'easeOut', delay: staggerDelay(i, reducedMotion) }" />`; for paths use `:initial="{ pathLength: 0 }" :animate="{ pathLength: 1 }"`. Bars use `fill-[var(--chart)]` and rounded tops (`rx="2"`). Table in `UiCard`.

- [ ] **Step 3: Finance**

Apply the recipe; stats via `UiStat` with `money(Math.round(n))` and `tone="danger"` for negative margins; table in `UiCard`; empty state `UiEmpty` with `Wallet`.

- [ ] **Step 4: Clients + ClientDetail**

Apply the recipe; client list rows `StaggerItem`; table in `UiCard`; empty state `UiEmpty` with `Users`; ClientDetail uses `PageHeader` with the `before` back link (same as project page).

- [ ] **Step 5: Settings sub-components**

Each section (`ThemeSettings`, `LanguageSettings`, workspaces, add project, ignore, `CategoriesSettings`, `TimeSettings`, `FinanceSettings`, `CommandReference`) becomes a `<UiCard as="section" class="p-5">`; the page is a single column `space-y-4` with `PageHeader`. `CommandReference` code blocks use `font-mono text-xs bg-surface-2 rounded-md p-3`. Remove the outer `<section>` from `ThemeSettings`/`LanguageSettings` only if the card wraps them from `SettingsView` (avoid nested cards: wrap in `SettingsView`, not inside the component).

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test && npm run build:web`. Browser: every page in dark, light, 390 px; complete a task and see it animate; daily chart draws in; finance tables scroll horizontally on mobile.

```bash
git add web/src/views web/src/components
git commit -m "feat(web): redesigned tasks, time, finance, clients and settings pages"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full checks**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Bundle size**

Run the gzip command from Task 1 Step 1 and compare with the baseline. Expected: growth under 80 KB gzip. If over, check that no `import * as` from `lucide-vue-next` slipped in (`grep -rn "from 'lucide-vue-next'" web/src` should only show named imports) and that fonts load only the latin subsets used.

- [ ] **Step 3: Leftover sweep**

Run: `grep -rn "border-y border-line\|text-2xl font-semibold tracking-tight\|hover:bg-surface\"" web/src/views web/src/components`
Expected: no hits outside `PageHeader.vue` (every page migrated).

- [ ] **Step 4: Browser pass**

With `npm start`: every page in dark, light, system; 390 px width; OS reduced motion on and off; keyboard-only run of the palette; Rescan toast; error toast with the server stopped. Note anything broken and fix before finishing.

- [ ] **Step 5: Bump version and commit**

Bump `version` in `package.json` from `0.5.0` to `0.6.0` (`src/version.ts` reads it), then:

```bash
git add -A
git commit -m "feat(web): UI redesign — Linear-style design system, sidebar, command palette, motion; v0.6"
```
