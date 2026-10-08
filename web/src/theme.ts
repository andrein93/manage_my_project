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
