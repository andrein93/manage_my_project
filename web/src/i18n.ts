import { createI18n } from 'vue-i18n'

type Messages = Record<string, unknown> & { _meta: { name: string } }

// Every locales/<code>.json is a language: adding a language is adding a file.
const modules = import.meta.glob<{ default: Messages }>('./locales/*.json', { eager: true })
const messages: Record<string, Messages> = Object.fromEntries(
  Object.entries(modules).map(([file, mod]) => [file.replace(/^.*\/(.+)\.json$/, '$1'), mod.default]),
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

function resolve(preference: string): string {
  if (preference !== 'auto' && messages[preference]) return preference
  const candidates = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const tag of candidates) {
    if (messages[tag]) return tag
    const base = tag.split('-')[0]
    if (messages[base]) return base
  }
  return 'en'
}

export const i18n = createI18n<false>({
  legacy: false,
  locale: resolve(preferredLanguage()),
  fallbackLocale: 'en',
  // Loaded from JSON at build time; shapes are checked by tests/locales.test.ts.
  messages: messages as never,
})

if (typeof document !== 'undefined') document.documentElement.lang = i18n.global.locale.value

export function setLanguage(preference: string): void {
  try {
    if (preference === 'auto') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  i18n.global.locale.value = resolve(preference)
  document.documentElement.lang = i18n.global.locale.value
}

/** Locale for dates and numbers: the interface language. */
export function uiLocale(): string {
  return i18n.global.locale.value
}
