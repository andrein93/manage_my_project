export interface Stamp {
  id: string
  version: string
}

export interface ChildHandle {
  kill(force?: boolean): void
  onExit(cb: (code: number | null) => void): void
}

export interface SupervisorDeps {
  /** `first` is true only for the very first child (it scans and opens the browser). */
  spawnChild(first: boolean): ChildHandle
  readStamp(): Stamp | null
  log(line: string): void
  /** The first server could not start at all (e.g. port in use): the supervisor gives up. */
  onFatal?(code: number | null): void
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export interface Supervisor {
  start(): void
  /** Call when the stamp file may have changed. */
  check(): void
  /** Stops the child and resolves with its exit code; nothing is spawned afterwards. */
  stop(): Promise<number | null>
}

/**
 * Runs the server as a child and restarts it when a new build stamp appears.
 * A child exiting within `graceMs` of its start is a failed start: wait for the next build.
 * A later crash is restarted after `crashDelayMs`.
 */
export function createSupervisor(
  deps: SupervisorDeps,
  options: { graceMs?: number; crashDelayMs?: number; killTimeoutMs?: number } = {},
): Supervisor {
  const graceMs = options.graceMs ?? 10_000
  const crashDelayMs = options.crashDelayMs ?? 1_000
  const killTimeoutMs = options.killTimeoutMs ?? 5_000

  let child: ChildHandle | null = null
  let running: Stamp | null = null // stamp the current (or last) child started with
  let pending: Stamp | null = null // stamp to start once the current child has exited
  let startedAt = 0
  let spawned = 0
  let firstRun = false // the current child is the very first one
  let waitingForBuild = false
  let stopping = false
  let lastCode: number | null = null
  let resolveStop: ((code: number | null) => void) | null = null
  const timers = new Set<unknown>()

  function timer(fn: () => void, ms: number) {
    const handle = deps.setTimer(() => {
      timers.delete(handle)
      fn()
    }, ms)
    timers.add(handle)
  }

  function clearTimers() {
    for (const t of timers) deps.clearTimer(t)
    timers.clear()
  }

  function launch(stamp: Stamp | null) {
    if (stopping) return
    running = stamp
    startedAt = deps.now()
    waitingForBuild = false
    firstRun = spawned === 0
    const handle = deps.spawnChild(spawned++ === 0)
    child = handle
    handle.onExit((code) => onExit(handle, code))
  }

  function onExit(handle: ChildHandle, code: number | null) {
    if (handle !== child) return
    child = null
    lastCode = code
    clearTimers()
    if (stopping) return resolveStop?.(code)
    if (pending) {
      const next = pending
      pending = null
      return launch(next)
    }
    if (deps.now() - startedAt < graceMs && firstRun) {
      // Nothing ever ran: report the error instead of waiting for a build that is not coming.
      stopping = true
      deps.onFatal?.(code)
      return
    }
    if (deps.now() - startedAt < graceMs) {
      waitingForBuild = true
      deps.log(`The server failed to start (exit code ${code ?? 'unknown'}). Waiting for the next build…`)
      return
    }
    deps.log(`The server stopped (exit code ${code ?? 'unknown'}). Restarting…`)
    timer(() => launch(deps.readStamp() ?? running), crashDelayMs)
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
      const alreadyStopping = pending !== null
      pending = stamp
      if (alreadyStopping) return
      const handle = child
      handle.kill()
      timer(() => {
        if (handle === child) handle.kill(true)
      }, killTimeoutMs)
    },

    stop() {
      stopping = true
      pending = null
      clearTimers()
      if (!child) return Promise.resolve(lastCode)
      const handle = child
      return new Promise((resolve) => {
        resolveStop = resolve
        handle.kill()
      })
    },
  }
}
