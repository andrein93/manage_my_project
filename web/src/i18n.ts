import { createI18n } from 'vue-i18n'

type Messages = Record<string, unknown> & { _meta: { name: string } }

function validLocale(code: string): boolean {
  try {
    return Intl.getCanonicalLocales(code).length === 1
  } catch {
    return false
  }
}

// Every locales/<code>.json is a language: adding a language is adding a file. Files with an
// invalid locale code or without _meta.name are skipped instead of breaking the dashboard.
const modules = import.meta.glob<{ default: Messages }>('./locales/*.json', { eager: true })
const messages: Record<string, Messages> = Object.fromEntries(
  Object.entries(modules)
    .map(([file, mod]) => [file.replace(/^.*\/(.+)\.json$/, '$1'), mod.default] as const)
    .filter(([code, m]) => validLocale(code) && typeof m?._meta?.name === 'string'),
)

export const LANGUAGES = Object.entries(messages)
  .map(([code, m]) => ({ code, name: m._meta.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const STORAGE_KEY = 'mmp.language'

/** 'auto' or a language code; stored per browser because it is a per-viewer preference. */
export function preferredLanguage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * `messages`: which translation to show. `format`: the locale for dates and numbers — the
 * browser's own tag in automatic mode (en-GB keeps day/month order), else the chosen language.
 */
function resolve(preference: string): { messages: string; format: string | undefined } {
  if (preference !== 'auto' && messages[preference]) return { messages: preference, format: preference }
  const candidates = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const tag of candidates) {
    if (messages[tag]) return { messages: tag, format: tag }
    const base = tag.split('-')[0]
    if (messages[base]) return { messages: base, format: validLocale(tag) ? tag : base }
  }
  return { messages: 'en', format: undefined }
}

let current = resolve(preferredLanguage())

export const i18n = createI18n<false>({
  legacy: false,
  locale: current.messages,
  fallbackLocale: 'en',
  // Loaded from JSON at build time; shapes are checked by tests/locales.test.ts.
  messages: messages as never,
})

if (typeof document !== 'undefined') document.documentElement.lang = current.format ?? current.messages

export function setLanguage(preference: string): void {
  try {
    if (preference === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  current = resolve(preference)
  i18n.global.locale.value = current.messages
  document.documentElement.lang = current.format ?? current.messages
}

/** Locale for dates and numbers (undefined = the browser default). */
export function uiLocale(): string | undefined {
  return current.format
}
