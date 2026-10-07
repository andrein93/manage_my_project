import { resolve, sep } from 'node:path'

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

/** Absolute path without a trailing separator. */
export function normalizePath(path: string): string {
  const abs = resolve(path)
  return abs.length > 1 && abs.endsWith(sep) && !/^[A-Za-z]:\\$/.test(abs) ? abs.slice(0, -1) : abs
}

/** Identity key for a path: normalized and, on case-insensitive filesystems, lower-cased. */
export function pathKey(path: string): string {
  const normalized = normalizePath(path)
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

/** True when `child` equals `parent` or is inside it. Both must be path keys. */
export function isWithin(childKey: string, parentKey: string): boolean {
  return childKey === parentKey || childKey.startsWith(parentKey.endsWith(sep) ? parentKey : parentKey + sep)
}
