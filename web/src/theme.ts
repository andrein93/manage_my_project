import { ref } from 'vue'
import { readPref, writePref } from './prefs'

export type ThemePreference = 'dark' | 'light'
export const THEME_PREFERENCES: ThemePreference[] = ['dark', 'light']
/** Also read by the inline script in web/index.html — keep the two in sync. */
export const THEME_KEY = 'mmp.theme'

/** Dark is the default: only an explicit 'light' switches. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === 'light' ? 'light' : 'dark'
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(readPref(THEME_KEY))
}

type ThemeRoot = Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>

export function applyThemePreference(pref: ThemePreference, root: ThemeRoot = document.documentElement): void {
  root.setAttribute('data-theme', pref)
}

export const themePreference = ref<ThemePreference>(readThemePreference())

export function setThemePreference(pref: ThemePreference): void {
  themePreference.value = pref
  writePref(THEME_KEY, pref === 'dark' ? null : pref)
  applyThemePreference(pref)
}

export function toggleTheme(): void {
  setThemePreference(themePreference.value === 'dark' ? 'light' : 'dark')
}

/** Theme set by another tab, or null when the storage event is about something else. A null key means storage was cleared. */
export function themeFromStorageEvent(e: Pick<StorageEvent, 'key' | 'newValue'>): ThemePreference | null {
  if (e.key !== null && e.key !== THEME_KEY) return null
  return parseThemePreference(e.newValue)
}

// Keep every open tab on the same theme.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const pref = themeFromStorageEvent(e)
    if (pref === null) return
    themePreference.value = pref
    applyThemePreference(pref)
  })
}
