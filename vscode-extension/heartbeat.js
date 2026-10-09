'use strict'

/**
 * Decides when to tell mmp that a workspace folder is being worked on.
 * At most one heartbeat per minute per folder (mmp counts active minutes); when mmp is not
 * running, stay quiet for a few minutes instead of failing on every keystroke.
 *
 * @param {{ send: (folder: string) => Promise<void>, now?: () => number, minIntervalMs?: number, offlineRetryMs?: number }} options
 */
function createHeartbeat({ send, now = Date.now, minIntervalMs = 60_000, offlineRetryMs = 5 * 60_000 }) {
  /** @type {Map<string, number>} */
  const lastSent = new Map()
  let offlineUntil = 0
  /** @type {'idle' | 'ok' | 'offline'} */
  let state = 'idle'

  return {
    /** Call on editing activity; returns true when a heartbeat was sent. */
    activity(folder) {
      if (!folder) return false
      const t = now()
      if (t < offlineUntil) return false
      const last = lastSent.get(folder)
      if (last !== undefined && t - last < minIntervalMs) return false
      // Mark before sending so a burst of keystrokes sends once.
      lastSent.set(folder, t)
      send(folder).then(
        () => {
          state = 'ok'
        },
        () => {
          state = 'offline'
          offlineUntil = t + offlineRetryMs
          lastSent.delete(folder)
        },
      )
      return true
    },
    status() {
      return state
    },
  }
}

module.exports = { createHeartbeat }
