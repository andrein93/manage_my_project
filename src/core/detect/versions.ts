import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** npm packages whose version is worth showing. */
const NODE_PACKAGES = ['vue', 'react', 'nuxt', 'next', 'svelte', '@angular/core', 'vite', 'tailwindcss']
/** Larger lockfiles are scanned with a targeted pattern instead of being parsed whole. */
const MAX_PARSE_BYTES = 2 * 1024 * 1024

const label = (pkg: string) => (pkg === '@angular/core' ? 'angular' : pkg)
/** "^3.4.1" → "3.4.1", "v10.48.2" → "10.48.2"; constraints like ">=8.2" are kept as-is. */
const clean = (v: string) => v.trim().replace(/^[v^~=]+/, '')
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

async function readText(file: string): Promise<string | null> {
  try {
    return (await readFile(file, 'utf8')).replace(/^﻿/, '')
  } catch {
    return null
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  const text = await readText(file)
  if (text === null) return null
  try {
    return obj(JSON.parse(text))
  } catch {
    return null
  }
}

/** Key framework/runtime versions from lockfiles (falling back to declared ranges). Never throws. */
export async function detectVersions(dir: string): Promise<Record<string, string>> {
  const versions: Record<string, string> = {}
  const tryStep = async (step: () => Promise<void>) => {
    try {
      await step()
    } catch {
      // A malformed file only loses its own versions.
    }
  }

  await tryStep(async () => {
    const lock = await readJson(join(dir, 'composer.lock'))
    if (!lock) return
    const list = [lock.packages, lock['packages-dev']].flatMap((p) => (Array.isArray(p) ? p : []))
    const laravel = list.map(obj).find((p) => p.name === 'laravel/framework')
    const version = laravel && str(laravel.version)
    if (version) versions.laravel = clean(version)
  })
  await tryStep(async () => {
    const composer = await readJson(join(dir, 'composer.json'))
    if (!composer) return
    const require = obj(composer.require)
    const php = str(require.php)
    if (php) versions.php = php.trim()
    const laravel = str(require['laravel/framework'])
    if (!versions.laravel && laravel) versions.laravel = clean(laravel)
  })
  await tryStep(async () => {
    const file = join(dir, 'wp-includes', 'version.php')
    if (!existsSync(file)) return
    const match = /\$wp_version\s*=\s*'([^']+)'/.exec((await readText(file)) ?? '')
    if (match) versions.wordpress = match[1]
  })
  await tryStep(async () => {
    const pkg = await readJson(join(dir, 'package.json'))
    if (!pkg) return
    const locked = await lockedNodeVersions(join(dir, 'package-lock.json'))
    const declared = { ...obj(pkg.dependencies), ...obj(pkg.devDependencies) }
    for (const name of NODE_PACKAGES) {
      const version = locked[name] ?? str(declared[name])
      if (version) versions[label(name)] = clean(version)
    }
    const node = str(obj(pkg.engines).node)
    if (node) versions.node = node.trim()
  })
  return versions
}

/** Versions of NODE_PACKAGES from package-lock.json (v1, v2 or v3). */
async function lockedNodeVersions(file: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let size: number
  try {
    size = (await stat(file)).size
  } catch {
    return out
  }
  const text = await readText(file)
  if (text === null) return out
  if (size <= MAX_PARSE_BYTES) {
    let lock: Record<string, unknown>
    try {
      lock = obj(JSON.parse(text))
    } catch {
      return out
    }
    const packages = obj(lock.packages)
    const dependencies = obj(lock.dependencies)
    for (const name of NODE_PACKAGES) {
      const version = str(obj(packages[`node_modules/${name}`]).version) ?? str(obj(dependencies[name]).version)
      if (version) out[name] = version
    }
    return out
  }
  // Big (monorepo) lockfiles: find just the entries we need.
  for (const name of NODE_PACKAGES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    const match = new RegExp(`"node_modules/${escaped}"\\s*:\\s*\\{[^{}]*?"version"\\s*:\\s*"([^"]+)"`).exec(text)
    if (match) out[name] = match[1]
  }
  return out
}

/** Major version of a version string or constraint ("^10.48" → "10", ">=8.2" → "8"), or null. */
export function majorOf(version: string): string | null {
  const match = /(\d+)/.exec(version)
  return match ? match[1] : null
}
