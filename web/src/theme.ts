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
