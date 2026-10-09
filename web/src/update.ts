/** A different build is running than the one this page was loaded from (both must be stamped builds). */
export function isNewBuild(seen: string | null, current: string | null): boolean {
  return seen !== null && current !== null && seen !== current
}
