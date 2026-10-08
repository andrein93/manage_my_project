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
