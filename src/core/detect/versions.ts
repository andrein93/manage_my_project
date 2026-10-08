import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** npm packages whose version is worth showing. */
const NODE_PACKAGES = ['vue', 'react', 'nuxt', 'next', 'svelte', '@angular/core', 'vite', 'tailwindcss']

const label = (pkg: string) => (pkg === '@angular/core' ? 'angular' : pkg)
/** "^3.4.1" → "3.4.1", "v10.48.2" → "10.48.2"; constraints like ">=8.2" are kept as-is. */
const clean = (v: string) => v.trim().replace(/^[v^~=]+/, '')

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** Key framework/runtime versions from lockfiles (falling back to declared ranges). Top level only. */
export async function detectVersions(dir: string): Promise<Record<string, string>> {
  const versions: Record<string, string> = {}

  const composerLock = await readJson(join(dir, 'composer.lock'))
  if (composerLock) {
    const packages = [...((composerLock.packages as { name: string; version: string }[]) ?? []), ...((composerLock['packages-dev'] as { name: string; version: string }[]) ?? [])]
    const laravel = packages.find((p) => p.name === 'laravel/framework')
    if (laravel) versions.laravel = clean(laravel.version)
  }
  const composer = await readJson(join(dir, 'composer.json'))
  if (composer) {
    const require = (composer.require ?? {}) as Record<string, string>
    if (require.php) versions.php = require.php.trim()
    if (!versions.laravel && require['laravel/framework']) versions.laravel = clean(require['laravel/framework'])
  }

  const wpVersionFile = join(dir, 'wp-includes', 'version.php')
  if (existsSync(wpVersionFile)) {
    try {
      const match = /\$wp_version\s*=\s*'([^']+)'/.exec(await readFile(wpVersionFile, 'utf8'))
      if (match) versions.wordpress = match[1]
    } catch {
      // unreadable: skip
    }
  }

  const pkg = await readJson(join(dir, 'package.json'))
  if (pkg) {
    const lock = await readJson(join(dir, 'package-lock.json'))
    const lockPackages = (lock?.packages ?? {}) as Record<string, { version?: string }>
    const lockDeps = (lock?.dependencies ?? {}) as Record<string, { version?: string }>
    const declared = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, string>
    for (const name of NODE_PACKAGES) {
      const locked = lockPackages[`node_modules/${name}`]?.version ?? lockDeps[name]?.version
      const version = locked ?? declared[name]
      if (version) versions[label(name)] = clean(version)
    }
    const engines = (pkg.engines ?? {}) as Record<string, string>
    if (engines.node) versions.node = engines.node.trim()
  }
  return versions
}

/** Major version of a version string or constraint ("^10.48" → "10", ">=8.2" → "8"), or null. */
export function majorOf(version: string): string | null {
  const match = /(\d+)/.exec(version)
  return match ? match[1] : null
}
