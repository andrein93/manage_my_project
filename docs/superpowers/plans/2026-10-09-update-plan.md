# mmp Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mmp update` brings a git install to the latest version, and a running `mmp start` restarts its server by itself when a new build appears, with a "Reload" notice in the dashboard.

**Architecture:** A build stamp (`dist/build.json`) written at the end of every successful build is the single restart trigger. `mmp start` becomes a supervisor that runs `mmp serve` as a child and restarts it when the stamp id changes; its logic is a pure state machine with injected spawn/timers. `mmp update` inspects git, decides with a pure `planUpdate`, then runs `git pull --ff-only` and `npm install`. The server exposes the stamp id in `/api/meta`; the dashboard compares it over time.

**Tech Stack:** Node ≥22 (ESM, TypeScript, `node:child_process`, `fs.watchFile`), commander, Fastify, Vue 3, vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-update-design.md`

## Global Constraints

- CLI output in English; every new UI string in all of `web/src/locales/{en,it,es,de,fr,zh}.json` (`tests/locales.test.ts`).
- Never modify an install with uncommitted tracked changes or local commits; only `git pull --ff-only`.
- Only a stamp written at the end of a successful `npm run build` may trigger a restart.
- Windows: npm is spawned as `npm.cmd` with `shell: true`; stamp polling uses `fs.watchFile` (2 s).
- Restart grace: a child exiting within 10 s of start is a failed start (wait for the next stamp); a later crash restarts once after 1 s; kill is forced after 5 s.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Stamp file present but malformed or half-written (JSON parse error, missing `id`) → treated as "no stamp", no restart, no crash. Test in Task 1.
2. Stamp changes twice quickly (two builds back to back) → only one child running afterwards, on the newest id. Test in Task 4.
3. Ctrl+C arrives while a restart is in progress or while the child is already exiting → parent exits, no new child is spawned. Test in Task 4.
4. `mmp update` run from a checkout whose upstream branch has diverged (ahead and behind) → refused with the "local commits" message, nothing pulled. Test in Task 2.
5. Dashboard served by a dev server with no stamp (`build: null`) → never shows the update notice. Test in Task 6.

---

## File map

Create: `scripts/stamp-build.mjs`, `src/build-info.ts`, `src/core/update.ts`, `src/cli/update.ts`, `src/cli/supervisor.ts`, `web/src/update.ts`, `tests/build-info.test.ts`, `tests/update.test.ts`, `tests/supervisor.test.ts`, `tests/web-update.test.ts`.
Modify: `package.json` (build script), `src/server/routes.ts` (meta.build), `src/cli/index.ts` (start/serve/update), `web/src/api.ts` (Meta.build), `web/src/App.vue` (notice), locales ×6, `README.md`, `tests/server.test.ts`.

---

### Task 1: Build stamp and `/api/meta.build`

**Files:** Create `scripts/stamp-build.mjs`, `src/build-info.ts`, `tests/build-info.test.ts`. Modify `package.json`, `src/server/routes.ts`, `tests/server.test.ts`.

**Interfaces:**
- Produces: `interface BuildInfo { id: string; version: string; builtAt: string }`, `readBuildInfo(installDir: string): BuildInfo | null` (reads `<installDir>/dist/build.json`), `buildStampPath(installDir: string): string`. `/api/meta` returns `build: string | null`.

- [ ] **Step 1: Failing tests** — `tests/build-info.test.ts`:

```ts
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
```

Add to `tests/server.test.ts` (inside the existing describe, after the meta test):

```ts
  it('exposes the build stamp id in meta', async () => {
    await server.close()
    mkdirSync(join(fx.installDir, 'dist'), { recursive: true })
    writeFileSync(join(fx.installDir, 'dist', 'build.json'), JSON.stringify({ id: 'b-42', version: '0.7.0', builtAt: 'x' }))
    server = await buildServer(fx.app, { webDir: join(fx.installDir, 'web') })
    expect((await server.inject({ url: '/api/meta' })).json().build).toBe('b-42')
  })

  it('reports no build in dev (no stamp)', async () => {
    expect((await server.inject({ url: '/api/meta' })).json().build).toBeNull()
  })
```

- [ ] **Step 2:** `npx vitest run tests/build-info.test.ts tests/server.test.ts` → FAIL (module missing; `build` undefined).

- [ ] **Step 3: Implement** `src/build-info.ts`:

```ts
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
```

In `src/server/routes.ts`: import `readBuildInfo`; in `registerRoutes` before the routes, `const build = readBuildInfo(app.config.installDir)?.id ?? null` (read once: the build the server started with); add `build,` to the `/meta` response object after `version: VERSION,`.

`scripts/stamp-build.mjs`:

```js
// Last step of `npm run build`: marks a complete build. A running `mmp start` restarts when this changes.
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const builtAt = new Date().toISOString()
const id = `${builtAt}-${Math.random().toString(36).slice(2, 6)}`
writeFileSync(new URL('dist/build.json', root), JSON.stringify({ id, version, builtAt }, null, 2) + '\n')
console.log(`Build ${id} (v${version})`)
```

`package.json`: `"build": "npm run build:server && npm run build:web && node scripts/stamp-build.mjs"`; add `"scripts"` to the `files` array.

- [ ] **Step 4:** rerun → PASS. `npm run build` → prints `Build …`, `dist/build.json` exists.
- [ ] **Step 5: Commit** `feat: build stamp written after successful builds, exposed in /api/meta`.

---

### Task 2: Update decision and git inspection

**Files:** Create `src/core/update.ts`, `tests/update.test.ts`.

**Interfaces:**
- Produces: `interface GitState { isRepo: boolean; branch: string | null; upstream: string | null; dirty: boolean; ahead: number; behind: number }`, `type UpdatePlan = { kind: 'refuse'; reason: string } | { kind: 'up-to-date' } | { kind: 'update'; commits: number }`, `planUpdate(state: GitState): UpdatePlan`, `inspectGit(dir: string, options?: { fetch?: boolean }): GitState`.

- [ ] **Step 1: Failing tests** — `tests/update.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGit, planUpdate, type GitState } from '../src/core/update.js'
import { hasGit } from './helpers.js'

const clean: GitState = { isRepo: true, branch: 'main', upstream: 'origin/main', dirty: false, ahead: 0, behind: 0 }

describe('planUpdate', () => {
  it('refuses outside git', () => {
    expect(planUpdate({ ...clean, isRepo: false })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('not installed from git') })
  })
  it('refuses without upstream or on a detached HEAD', () => {
    expect(planUpdate({ ...clean, upstream: null })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('no upstream') })
    expect(planUpdate({ ...clean, branch: null, upstream: null })).toMatchObject({ kind: 'refuse' })
  })
  it('refuses with local changes', () => {
    expect(planUpdate({ ...clean, dirty: true, behind: 3 })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('local changes') })
  })
  it('refuses with local commits, also when diverged', () => {
    expect(planUpdate({ ...clean, ahead: 2 })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('2 local commits') })
    expect(planUpdate({ ...clean, ahead: 1, behind: 4 })).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('1 local commit') })
  })
  it('is up to date or fast-forwards', () => {
    expect(planUpdate(clean)).toEqual({ kind: 'up-to-date' })
    expect(planUpdate({ ...clean, behind: 5 })).toEqual({ kind: 'update', commits: 5 })
  })
})

describe.runIf(hasGit)('inspectGit', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()

  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'mmp-git-'))
    dirs.push(root)
    const remote = join(root, 'remote.git')
    const a = join(root, 'a')
    const b = join(root, 'b')
    execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'pipe' })
    execFileSync('git', ['clone', remote, a], { stdio: 'pipe' })
    for (const d of [a]) {
      git(d, 'config', 'user.email', 't@t')
      git(d, 'config', 'user.name', 't')
    }
    writeFileSync(join(a, 'f.txt'), '1')
    git(a, 'add', '.')
    git(a, 'commit', '-m', 'one')
    git(a, 'push', 'origin', 'main')
    execFileSync('git', ['clone', remote, b], { stdio: 'pipe' })
    git(b, 'config', 'user.email', 't@t')
    git(b, 'config', 'user.name', 't')
    return { root, a, b }
  }

  it('reports a clean, up-to-date clone', () => {
    const { b } = setup()
    expect(inspectGit(b)).toEqual({ isRepo: true, branch: 'main', upstream: 'origin/main', dirty: false, ahead: 0, behind: 0 })
  })

  it('sees commits behind after fetch, and local changes', () => {
    const { a, b } = setup()
    writeFileSync(join(a, 'f.txt'), '2')
    git(a, 'commit', '-am', 'two')
    git(a, 'push', 'origin', 'main')
    writeFileSync(join(b, 'f.txt'), 'local edit')
    expect(inspectGit(b, { fetch: true })).toMatchObject({ dirty: true, ahead: 0, behind: 1 })
  })

  it('ignores untracked files and reports non-repos', () => {
    const { b, root } = setup()
    writeFileSync(join(b, 'notes.txt'), 'x')
    expect(inspectGit(b).dirty).toBe(false)
    expect(inspectGit(root).isRepo).toBe(false)
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/update.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/core/update.ts`:

```ts
import { execFileSync } from 'node:child_process'

export interface GitState {
  isRepo: boolean
  branch: string | null
  upstream: string | null
  /** Uncommitted changes to tracked files (untracked files do not count). */
  dirty: boolean
  ahead: number
  behind: number
}

export type UpdatePlan = { kind: 'refuse'; reason: string } | { kind: 'up-to-date' } | { kind: 'update'; commits: number }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What `mmp update` may do: only fast-forward a clean checkout that tracks a remote branch. */
export function planUpdate(s: GitState): UpdatePlan {
  if (!s.isRepo) return { kind: 'refuse', reason: 'mmp was not installed from git; reinstall it from the repository to update.' }
  if (!s.branch || !s.upstream) return { kind: 'refuse', reason: `branch ${s.branch ?? '(detached HEAD)'} has no upstream; set one or update by hand.` }
  if (s.dirty) return { kind: 'refuse', reason: 'you have local changes; commit or stash them first.' }
  if (s.ahead > 0) return { kind: 'refuse', reason: `this install has ${plural(s.ahead, 'local commit')} not on ${s.upstream}; push or reset them before updating.` }
  if (s.behind === 0) return { kind: 'up-to-date' }
  return { kind: 'update', commits: s.behind }
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch {
    return null
  }
}

export function inspectGit(dir: string, options: { fetch?: boolean } = {}): GitState {
  if (git(dir, ['rev-parse', '--show-toplevel']) === null) {
    return { isRepo: false, branch: null, upstream: null, dirty: false, ahead: 0, behind: 0 }
  }
  const branchName = git(dir, ['symbolic-ref', '--short', '-q', 'HEAD'])
  const branch = branchName || null
  const upstream = branch ? git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) : null
  const dirty = (git(dir, ['status', '--porcelain', '--untracked-files=no']) ?? '') !== ''
  if (!upstream) return { isRepo: true, branch, upstream: null, dirty, ahead: 0, behind: 0 }
  if (options.fetch) git(dir, ['fetch', '--quiet'])
  const [ahead, behind] = (git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']) ?? '0\t0').split(/\s+/).map(Number)
  return { isRepo: true, branch, upstream, dirty, ahead: ahead || 0, behind: behind || 0 }
}
```

- [ ] **Step 4:** rerun → PASS. If `git init -b` is unsupported on the machine's git (< 2.28), the setup fails: check `git --version` and record a ruling.
- [ ] **Step 5: Commit** `feat(update): decide whether an install can be fast-forwarded`.

---

### Task 3: `mmp update` command

**Files:** Create `src/cli/update.ts`. Modify `src/cli/index.ts`. Test: `tests/cli.test.ts` (append).

**Interfaces:**
- Consumes: `inspectGit`, `planUpdate` (Task 2), `readBuildInfo` (Task 1), `VERSION`.
- Produces: `registerUpdateCommand(program: Command, getInstallDir: () => string, out: (line: string) => void): void`.

- [ ] **Step 1: Failing test** — append to `tests/cli.test.ts`:

```ts
describe('update', () => {
  it('refuses to update an install that is not a git clone', async () => {
    await expect(mmp('update', '--check')).rejects.toThrow(/not installed from git/)
  })
})
```

(`fx.installDir` is a plain temp folder, so `inspectGit` reports `isRepo: false`. The command throws `UserError`, which `exitOverride` surfaces as a rejection.)

- [ ] **Step 2:** `npx vitest run tests/cli.test.ts -t update` → FAIL (unknown command).

- [ ] **Step 3: Implement** `src/cli/update.ts`:

```ts
import { spawnSync } from 'node:child_process'
import type { Command } from 'commander'
import { readBuildInfo } from '../build-info.js'
import { inspectGit, planUpdate } from '../core/update.js'
import { UserError } from '../core/types.js'
import { VERSION } from '../version.js'

function run(cmd: string, args: string[], cwd: string) {
  const win = process.platform === 'win32'
  const result = spawnSync(win && cmd === 'npm' ? 'npm.cmd' : cmd, args, { cwd, stdio: 'inherit', shell: win && cmd === 'npm' })
  if (result.status !== 0) throw new UserError(`"${cmd} ${args.join(' ')}" failed (exit code ${result.status ?? 'unknown'}). Nothing else was changed.`)
}

export function registerUpdateCommand(program: Command, getInstallDir: () => string, out: (line: string) => void) {
  program
    .command('update')
    .description('update mmp to the latest version (git installs) and rebuild it')
    .option('--check', 'only report whether an update is available')
    .action((opts: { check?: boolean }) => {
      const dir = getInstallDir()
      const plan = planUpdate(inspectGit(dir, { fetch: true }))
      if (plan.kind === 'refuse') throw new UserError(`Cannot update: ${plan.reason}`)
      if (plan.kind === 'up-to-date') return out(`mmp ${VERSION} is up to date.`)
      if (opts.check) return out(`An update is available: ${plan.commits} new commit(s). Run "mmp update" to install it.`)
      run('git', ['pull', '--ff-only'], dir)
      run('npm', ['install'], dir)
      const after = readBuildInfo(dir)?.version ?? VERSION
      out(`Updated mmp ${VERSION} → ${after} (${plan.commits} commit(s)).`)
      out('A running "mmp start" restarts by itself. Restart Claude Code sessions to use the new MCP tools.')
    })
}
```

In `src/cli/index.ts`: import and call `registerUpdateCommand(program, () => getApp().config.installDir, out)` next to the other `register*` calls.

- [ ] **Step 4:** rerun → PASS. Manual: `node bin/mmp.js update --check` in this repo → prints up to date, or refuses with the local-changes/local-commits message (expected on a dev checkout).
- [ ] **Step 5: Commit** `feat(cli): mmp update for git installs`.

---

### Task 4: Supervisor state machine

**Files:** Create `src/cli/supervisor.ts`, `tests/supervisor.test.ts`.

**Interfaces:**
- Produces:

```ts
export interface Stamp { id: string; version: string }
export interface ChildHandle { kill(force?: boolean): void; onExit(cb: (code: number | null) => void): void }
export interface SupervisorDeps {
  spawnChild(first: boolean): ChildHandle
  readStamp(): Stamp | null
  log(line: string): void
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}
export interface Supervisor { start(): void; check(): void; stop(): Promise<number | null> }
export function createSupervisor(deps: SupervisorDeps, options?: { graceMs?: number; crashDelayMs?: number; killTimeoutMs?: number }): Supervisor
```

- [ ] **Step 1: Failing tests** — `tests/supervisor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createSupervisor, type ChildHandle, type Stamp } from '../src/cli/supervisor.js'

function harness(initial: Stamp | null = { id: 'a', version: '0.6.0' }) {
  let time = 0
  let stamp = initial
  const children: { first: boolean; killed: boolean; forced: boolean; exit: (code: number | null) => void }[] = []
  const timers: { at: number; fn: () => void; id: number }[] = []
  const logs: string[] = []
  let nextTimer = 1
  const sup = createSupervisor({
    spawnChild(first) {
      let cb: (code: number | null) => void = () => {}
      const c = { first, killed: false, forced: false, exit: (code: number | null) => cb(code) }
      children.push(c)
      const handle: ChildHandle = {
        kill: (force) => { c.killed = true; c.forced ||= !!force },
        onExit: (fn) => { cb = fn },
      }
      return handle
    },
    readStamp: () => stamp,
    log: (l) => logs.push(l),
    now: () => time,
    setTimer: (fn, ms) => { const id = nextTimer++; timers.push({ at: time + ms, fn, id }); return id },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) },
  })
  const advance = (ms: number) => {
    time += ms
    for (const t of timers.filter((t) => t.at <= time)) { timers.splice(timers.indexOf(t), 1); t.fn() }
  }
  return { sup, children, logs, advance, setStamp: (s: Stamp | null) => (stamp = s), last: () => children.at(-1)! }
}

describe('supervisor', () => {
  it('starts one child, marked as the first', () => {
    const h = harness()
    h.sup.start()
    expect(h.children).toHaveLength(1)
    expect(h.children[0].first).toBe(true)
  })

  it('restarts on a new stamp: stop first, then start', () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    expect(h.children[0].killed).toBe(true)
    expect(h.children).toHaveLength(1)
    h.children[0].exit(0)
    expect(h.children).toHaveLength(2)
    expect(h.children[1].first).toBe(false)
    expect(h.logs.join('\n')).toContain('0.6.0 → 0.7.0')
  })

  it('ignores an unchanged or missing stamp', () => {
    const h = harness()
    h.sup.start()
    h.sup.check()
    h.setStamp(null)
    h.sup.check()
    expect(h.children[0].killed).toBe(false)
  })

  it('two quick stamps end with one child on the newest build', () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    h.setStamp({ id: 'c', version: '0.7.1' })
    h.sup.check()
    h.children[0].exit(0)
    expect(h.children).toHaveLength(2)
    h.advance(20_000)
    h.sup.check()
    expect(h.children).toHaveLength(2)
    expect(h.children[1].killed).toBe(false)
  })

  it('forces the kill after the timeout', () => {
    const h = harness()
    h.sup.start()
    h.advance(20_000)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    h.advance(5_000)
    expect(h.children[0].forced).toBe(true)
  })

  it('a child failing at startup waits for the next stamp', () => {
    const h = harness()
    h.sup.start()
    h.advance(2_000)
    h.children[0].exit(1)
    h.advance(60_000)
    expect(h.children).toHaveLength(1)
    expect(h.logs.join('\n')).toMatch(/failed to start/)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    expect(h.children).toHaveLength(2)
  })

  it('a late crash restarts once after 1 s', () => {
    const h = harness()
    h.sup.start()
    h.advance(60_000)
    h.children[0].exit(1)
    expect(h.children).toHaveLength(1)
    h.advance(1_000)
    expect(h.children).toHaveLength(2)
  })

  it('stop kills the child, resolves with its code and spawns nothing more', async () => {
    const h = harness()
    h.sup.start()
    h.advance(60_000)
    const done = h.sup.stop()
    expect(h.children[0].killed).toBe(true)
    h.children[0].exit(0)
    expect(await done).toBe(0)
    h.setStamp({ id: 'b', version: '0.7.0' })
    h.sup.check()
    h.advance(60_000)
    expect(h.children).toHaveLength(1)
  })

  it('stop during a pending crash restart cancels it', async () => {
    const h = harness()
    h.sup.start()
    h.advance(60_000)
    h.children[0].exit(1)
    const done = h.sup.stop()
    expect(await done).toBe(1)
    h.advance(5_000)
    expect(h.children).toHaveLength(1)
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/supervisor.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/cli/supervisor.ts`:

```ts
export interface Stamp {
  id: string
  version: string
}
export interface ChildHandle {
  kill(force?: boolean): void
  onExit(cb: (code: number | null) => void): void
}
export interface SupervisorDeps {
  spawnChild(first: boolean): ChildHandle
  readStamp(): Stamp | null
  log(line: string): void
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}
export interface Supervisor {
  start(): void
  /** Call when the stamp file may have changed. */
  check(): void
  stop(): Promise<number | null>
}

/**
 * Runs the server as a child and restarts it when a new build stamp appears.
 * A child exiting within `graceMs` of its start is a failed start: wait for the next build.
 */
export function createSupervisor(deps: SupervisorDeps, options: { graceMs?: number; crashDelayMs?: number; killTimeoutMs?: number } = {}): Supervisor {
  const graceMs = options.graceMs ?? 10_000
  const crashDelayMs = options.crashDelayMs ?? 1_000
  const killTimeoutMs = options.killTimeoutMs ?? 5_000

  let child: ChildHandle | null = null
  let running: Stamp | null = null // stamp the current (or last) child started with
  let startedAt = 0
  let spawned = 0
  let pending: Stamp | null = null // stamp to start once the current child has exited
  let waitingForBuild = false
  let stopping = false
  let lastCode: number | null = null
  let resolveStop: ((code: number | null) => void) | null = null
  const timers = new Set<unknown>()

  const timer = (fn: () => void, ms: number) => {
    const handle = deps.setTimer(() => {
      timers.delete(handle)
      fn()
    }, ms)
    timers.add(handle)
    return handle
  }

  function launch(stamp: Stamp | null) {
    if (stopping) return
    running = stamp
    startedAt = deps.now()
    waitingForBuild = false
    const handle = deps.spawnChild(spawned++ === 0)
    child = handle
    handle.onExit((code) => onExit(handle, code))
  }

  function onExit(handle: ChildHandle, code: number | null) {
    if (handle !== child) return
    child = null
    lastCode = code
    for (const t of timers) deps.clearTimer(t)
    timers.clear()
    if (stopping) return resolveStop?.(code)
    if (pending) {
      const next = pending
      pending = null
      return launch(next)
    }
    if (deps.now() - startedAt < graceMs) {
      waitingForBuild = true
      deps.log(`The server failed to start (exit code ${code ?? 'unknown'}). Waiting for the next build…`)
      return
    }
    deps.log(`The server stopped (exit code ${code ?? 'unknown'}). Restarting…`)
    timer(() => launch(running), crashDelayMs)
  }

  return {
    start() {
      launch(deps.readStamp())
    },
    check() {
      if (stopping) return
      const stamp = deps.readStamp()
      if (!stamp || stamp.id === (pending ?? running)?.id) return
      if (!child) {
        if (waitingForBuild) launch(stamp)
        return
      }
      deps.log(`mmp ${running?.version ?? '?'} → ${stamp.version}: restarting…`)
      const restarting = pending !== null
      pending = stamp
      if (restarting) return
      child.kill()
      const handle = child
      timer(() => handle === child && handle.kill(true), killTimeoutMs)
    },
    stop() {
      stopping = true
      for (const t of timers) deps.clearTimer(t)
      timers.clear()
      if (!child) return Promise.resolve(lastCode)
      return new Promise((resolve) => {
        resolveStop = resolve
        child!.kill()
      })
    },
  }
}
```

- [ ] **Step 4:** rerun → PASS (9 tests).
- [ ] **Step 5: Commit** `feat(cli): supervisor that restarts the server on a new build`.

---

### Task 5: `mmp serve` and supervising `mmp start`

**Files:** Modify `src/cli/index.ts`.

**Interfaces:**
- Consumes: `createSupervisor` (Task 4), `readBuildInfo`, `buildStampPath` (Task 1).
- Produces: hidden command `serve [--scan] [--open]`; `start` keeps its `--no-open` option.

- [ ] **Step 1: Implement.** Replace the `start` command in `src/cli/index.ts` with:

```ts
  program
    .command('serve', { hidden: true })
    .description('run the web server (used by "mmp start")')
    .option('--scan', 'scan workspaces first')
    .option('--open', 'open the dashboard in the browser')
    .action(async (opts: { scan?: boolean; open?: boolean }) => {
      const app = getApp()
      const { startServer } = await import('../server/index.js')
      if (opts.scan) {
        const result = await app.scan()
        out(`Scanned ${result.total} projects in ${result.durationMs} ms`)
      }
      const { url } = await startServer(app)
      out(`Dashboard running at ${url}  (Ctrl+C to stop)`)
      if (opts.open && app.config.openBrowser) {
        const { openUrl } = await import('../server/open.js')
        openUrl(url)
      }
    })

  program
    .command('start')
    .description('start the web dashboard (scans first); restarts by itself after an update')
    .option('--no-open', 'do not open the browser')
    .action(async (opts: { open: boolean }) => {
      const { spawn } = await import('node:child_process')
      const { watchFile, unwatchFile } = await import('node:fs')
      const { fileURLToPath } = await import('node:url')
      const { createSupervisor } = await import('./supervisor.js')
      const { buildStampPath, readBuildInfo } = await import('../build-info.js')
      const { loadConfig } = await import('../config.js')
      const installDir = loadConfig().installDir
      const entry = fileURLToPath(new URL('../../bin/mmp.js', import.meta.url))
      const supervisor = createSupervisor({
        spawnChild(first) {
          const args = [entry, 'serve', ...(first ? ['--scan', ...(opts.open ? ['--open'] : [])] : [])]
          const child = spawn(process.execPath, args, { stdio: 'inherit' })
          return {
            kill: (force) => child.kill(force ? 'SIGKILL' : 'SIGTERM'),
            onExit: (cb) => child.on('exit', (code) => cb(code)),
          }
        },
        readStamp: () => readBuildInfo(installDir),
        log: out,
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      })
      const stamp = buildStampPath(installDir)
      supervisor.start()
      watchFile(stamp, { interval: 2000 }, () => supervisor.check())
      const shutdown = async () => {
        unwatchFile(stamp)
        process.exitCode = (await supervisor.stop()) ?? 0
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
    })
```

The `loadConfig` import must resolve the same `.env` as `getApp()`; it does (same default install dir). The parent never opens the database.

- [ ] **Step 2: Verify manually** (record output in the ledger):
  1. `npm run build`, then in terminal A: `node bin/mmp.js start --no-open` → "Scanned …", "Dashboard running at …".
  2. Terminal B: `npm run build` → within ~2 s terminal A prints `mmp 0.6.0 → 0.6.0: restarting…` then a new "Dashboard running at …"; `curl http://127.0.0.1:4477/api/meta` shows the new `build` id.
  3. Terminal B: `npm run build:server` only (no stamp step) → terminal A does not restart.
  4. Ctrl+C in terminal A → both processes exit (check with `curl` → connection refused).
- [ ] **Step 3:** `npm run typecheck && npm test` → pass.
- [ ] **Step 4: Commit** `feat(cli): mmp start restarts its server when a new build appears`.

---

### Task 6: Dashboard "updated" notice

**Files:** Create `web/src/update.ts`, `tests/web-update.test.ts`. Modify `web/src/api.ts`, `web/src/App.vue`, locales ×6.

**Interfaces:**
- Consumes: `/api/meta.build` (Task 1).
- Produces: `isNewBuild(seen: string | null, current: string | null): boolean`.

- [ ] **Step 1: Failing test** — `tests/web-update.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isNewBuild } from '../web/src/update'

describe('isNewBuild', () => {
  it('is true only when both builds are known and differ', () => {
    expect(isNewBuild('a', 'b')).toBe(true)
    expect(isNewBuild('a', 'a')).toBe(false)
  })
  it('never fires without stamps (dev server)', () => {
    expect(isNewBuild(null, 'b')).toBe(false)
    expect(isNewBuild('a', null)).toBe(false)
    expect(isNewBuild(null, null)).toBe(false)
  })
})
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `web/src/update.ts`:

```ts
/** A different build is running than the one this page was loaded from (both must be stamped builds). */
export function isNewBuild(seen: string | null, current: string | null): boolean {
  return seen !== null && current !== null && seen !== current
}
```

`web/src/api.ts`: add `build: string | null` to `interface Meta`.

`App.vue` (script): import `isNewBuild` from `./update` and `CircleArrowUp` from `lucide-vue-next`. Add:

```ts
// Notice when the server was restarted on a new build (mmp update, or a manual rebuild).
const seenBuild = ref<string | null | undefined>(undefined)
const newVersion = ref<string | null>(null)
async function checkBuild() {
  try {
    const meta = await api.meta()
    if (seenBuild.value === undefined) seenBuild.value = meta.build
    else if (isNewBuild(seenBuild.value, meta.build)) newVersion.value = meta.version
  } catch {
    // Server restarting or offline: try again later.
  }
}
let buildTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  checkBuild()
  window.addEventListener('focus', checkBuild)
  buildTimer = setInterval(checkBuild, 60_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', checkBuild)
  clearInterval(buildTimer)
})
```

`App.vue` (template), as the first child of `<div class="min-w-0 flex-1">`:

```vue
<div v-if="newVersion" class="flex items-center gap-3 border-b border-action/30 bg-action/10 px-4 py-2 text-sm sm:px-8" role="status">
  <CircleArrowUp class="size-4 shrink-0 text-action" aria-hidden="true" />
  <span class="flex-1">{{ t('update.available', { version: newVersion }) }}</span>
  <button class="btn btn-sm btn-primary" @click="reload">{{ t('update.reload') }}</button>
</div>
```

with `const reload = () => location.reload()` in the script.

Locales — add a top-level `"update"` object:
- en: `{ "available": "mmp was updated to v{version}.", "reload": "Reload" }`
- it: `{ "available": "mmp è stato aggiornato alla v{version}.", "reload": "Ricarica" }`
- es: `{ "available": "mmp se ha actualizado a la v{version}.", "reload": "Recargar" }`
- de: `{ "available": "mmp wurde auf v{version} aktualisiert.", "reload": "Neu laden" }`
- fr: `{ "available": "mmp a été mis à jour en v{version}.", "reload": "Recharger" }`
- zh: `{ "available": "mmp 已更新到 v{version}。", "reload": "重新加载" }`

- [ ] **Step 4:** `npm run typecheck && npm test` → pass. Browser (headless CDP): load the dashboard, run `npm run build` while `mmp start` (from Task 5) is running, focus the page → the bar appears with the version; Reload removes it.
- [ ] **Step 5: Commit** `feat(web): notice with Reload after the server restarts on a new build`.

---

### Task 7: Docs and wrap-up

- [ ] README: in **Install**, add an "Updating" paragraph:

```markdown
### Updating

    mmp update          # or: node bin/mmp.js update

It pulls the latest version and rebuilds it. A running `mmp start` restarts by itself and the
dashboard offers to reload. `mmp update` refuses to touch an install with local changes or local
commits. Restart Claude Code sessions to pick up new MCP tools.
```

- [ ] `npm run typecheck && npm test && npm run build`; commit `docs: updating mmp`; push to `origin/main` after checking for new remote commits.
