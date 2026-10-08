import { ref } from 'vue'

export type ToastTone = 'info' | 'error'
export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

export const MAX_TOASTS = 4
export const toasts = ref<Toast[]>([])

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/** Info toasts close after `ttl` ms; errors stay until dismissed. A repeated message replaces the old toast. */
export function pushToast(message: string, tone: ToastTone = 'info', ttl = 5000): number {
  for (const t of toasts.value.filter((t) => t.message === message)) dismissToast(t.id)
  const id = nextId++
  toasts.value = [...toasts.value, { id, tone, message }]
  if (tone === 'info') timers.set(id, setTimeout(() => dismissToast(id), ttl))
  while (toasts.value.length > MAX_TOASTS) dismissToast(toasts.value[0].id)
  return id
}
