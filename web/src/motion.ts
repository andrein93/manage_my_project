import { ref } from 'vue'

export const STAGGER_STEP = 0.03
/** Items past this index enter together, so long lists don't wait. */
export const STAGGER_CAP = 10

/** Entrance delay in seconds for the i-th item of a list. */
export function staggerDelay(index: number, reduced = false): number {
  if (reduced) return 0
  return Math.min(Math.max(index, 0), STAGGER_CAP) * STAGGER_STEP
}

/** Value between `from` and `to` at `progress` (0..1, clamped), ease-out cubic. */
export function tween(from: number, to: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return from + (to - from) * (1 - (1 - p) ** 3)
}

const media = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null)

const reducedQuery = media('(prefers-reduced-motion: reduce)')
export const reducedMotion = ref(reducedQuery?.matches ?? false)
reducedQuery?.addEventListener('change', (e) => (reducedMotion.value = e.matches))

/** Pointer-following effects only make sense with a mouse or trackpad. */
export const finePointer = media('(pointer: fine)')?.matches ?? false
