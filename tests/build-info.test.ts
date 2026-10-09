import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildStampPath, readBuildInfo } from '../src/build-info.js'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mmp-stamp-'))
  mkdirSync(join(dir, 'dist'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readBuildInfo', () => {
  it('reads a valid stamp', () => {
    writeFileSync(buildStampPath(dir), JSON.stringify({ id: 'a1', version: '0.7.0', builtAt: '2026-10-09T10:00:00.000Z' }))
    expect(readBuildInfo(dir)).toEqual({ id: 'a1', version: '0.7.0', builtAt: '2026-10-09T10:00:00.000Z' })
  })

  it('returns null when the stamp is missing', () => {
    expect(readBuildInfo(dir)).toBeNull()
  })

  it('returns null for a half-written or malformed stamp', () => {
    writeFileSync(buildStampPath(dir), '{"id": "a1", "vers')
    expect(readBuildInfo(dir)).toBeNull()
    writeFileSync(buildStampPath(dir), JSON.stringify({ version: '0.7.0' }))
    expect(readBuildInfo(dir)).toBeNull()
  })
})
