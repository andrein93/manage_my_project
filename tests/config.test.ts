import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mmp-config-'))

  it('uses defaults', () => {
    const config = loadConfig({ env: {}, installDir: dir, envFile: join(dir, 'missing') })
    expect(config.port).toBe(4477)
    expect(config.host).toBe('127.0.0.1')
    expect(config.dataDir).toBe(join(homedir(), '.manage-my-projects'))
    expect(config.openBrowser).toBe(true)
    expect(config.allowedHosts).toEqual([])
  })

  it('reads .env and lets process env win', () => {
    const envFile = join(dir, '.env')
    writeFileSync(envFile, 'MMP_PORT=5000\nMMP_OPEN_BROWSER=false\nMMP_ALLOWED_HOSTS=Foo.test, bar.test\n')
    const config = loadConfig({ env: { MMP_PORT: '6000' }, installDir: dir, envFile })
    expect(config.port).toBe(6000)
    expect(config.openBrowser).toBe(false)
    expect(config.allowedHosts).toEqual(['foo.test', 'bar.test'])
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ env: { MMP_PORT: 'abc' }, installDir: dir, envFile: join(dir, 'x') })).toThrow(/MMP_PORT/)
  })
})
