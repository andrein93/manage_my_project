import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadConfig } from '../src/config.js'
import { createApp, type App } from '../src/core/app.js'

export interface Fixture {
  root: string
  installDir: string
  app: App
  /** Creates files (path → content) relative to the fixture root. */
  write(files: Record<string, string>): void
  cleanup(): void
}

/**
 * A temp "projects folder" with mmp installed at `<root>/mmp`, so the default
 * workspace is `<root>` exactly like a real clone.
 */
export function createFixture(files: Record<string, string> = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'mmp-test-'))
  const installDir = join(root, 'mmp')
  mkdirSync(installDir)
  const write = (entries: Record<string, string>) => {
    for (const [rel, content] of Object.entries(entries)) {
      const file = join(root, rel)
      mkdirSync(dirname(file), { recursive: true })
      if (rel.endsWith('/')) mkdirSync(file, { recursive: true })
      else writeFileSync(file, content)
    }
  }
  write(files)
  const config = loadConfig({ env: { MMP_DATA_DIR: join(root, '.data') }, installDir, envFile: join(root, 'none') })
  const app = createApp({ config, dbFile: ':memory:' })
  return {
    root,
    installDir,
    app,
    write,
    cleanup() {
      app.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

export const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

export function gitInit(dir: string): void {
  const run = (...args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], {
      stdio: 'ignore',
    })
  run('init', '-q', '-b', 'main')
  run('add', '-A')
  run('commit', '-q', '-m', 'init')
  run('remote', 'add', 'origin', 'https://example.com/repo.git')
}
