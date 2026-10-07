import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** npm dependency → stack label. Order defines output order. */
const NODE_FRAMEWORKS: [string, string][] = [
  ['nuxt', 'nuxt'],
  ['next', 'next'],
  ['vue', 'vue'],
  ['react', 'react'],
  ['svelte', 'svelte'],
  ['@angular/core', 'angular'],
  ['express', 'express'],
]

/** Detects the technologies used by a project from its top-level files. */
export async function detectStack(dir: string): Promise<string[]> {
  const names = new Set((await readdir(dir)).map((n) => n.toLowerCase()))
  const stack: string[] = []
  const has = (name: string) => names.has(name)

  if (has('artisan') && has('composer.json')) stack.push('laravel')
  if (has('wp-config.php') || has('wp-content')) stack.push('wordpress')
  if (has('composer.json')) stack.push('php')

  if (has('package.json')) {
    stack.push('node')
    stack.push(...(await nodeFrameworks(join(dir, 'package.json'))))
  }

  if (has('pyproject.toml') || has('requirements.txt')) stack.push('python')
  if (has('go.mod')) stack.push('go')
  if (has('cargo.toml')) stack.push('rust')
  if (has('gemfile')) stack.push('ruby')

  const files = [...names]
  if (!stack.includes('php') && files.some((n) => n.endsWith('.php'))) stack.push('php')
  if (stack.length === 0 && files.some((n) => n.endsWith('.html'))) stack.push('static')

  return [...new Set(stack)]
}

async function nodeFrameworks(packageJsonPath: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return NODE_FRAMEWORKS.filter(([dep]) => dep in deps).map(([, label]) => label)
  } catch {
    return []
  }
}
