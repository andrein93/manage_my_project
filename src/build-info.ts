import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BuildInfo {
  id: string
  version: string
  builtAt: string
}

export const buildStampPath = (installDir: string) => join(installDir, 'dist', 'build.json')

/** The stamp written at the end of a successful build; null when missing, half-written or malformed. */
export function readBuildInfo(installDir: string): BuildInfo | null {
  try {
    const data = JSON.parse(readFileSync(buildStampPath(installDir), 'utf8'))
    if (typeof data?.id !== 'string' || typeof data.version !== 'string') return null
    return { id: data.id, version: data.version, builtAt: String(data.builtAt ?? '') }
  } catch {
    return null
  }
}
