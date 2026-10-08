import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ApiError } from './api'

/** Calls `load` on mount, when the window regains focus and every `intervalMs`. */
export function useAutoRefresh(load: () => unknown, intervalMs = 30_000) {
  let timer: ReturnType<typeof setInterval> | undefined
  const onFocus = () => load()
  onMounted(() => {
    load()
    window.addEventListener('focus', onFocus)
    timer = setInterval(() => document.visibilityState === 'visible' && load(), intervalMs)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('focus', onFocus)
    clearInterval(timer)
  })
}

/** Shared error message state for API calls. */
export function useErrors() {
  const { t } = useI18n()
  const error = ref<string | null>(null)
  const report = (e: unknown) => {
    error.value =
      e instanceof ApiError && e.status === 0
        ? t('error.offline')
        : e instanceof Error
          ? e.message
          : t('error.generic', { message: String(e) })
  }
  return { error, report, clear: () => (error.value = null) }
}

export type Freshness = 'fresh' | 'aging' | 'dormant' | 'never'

const DAY = 86_400_000
const SPAN_DAYS = 5 * 365

/** Days since activity, freshness bucket and position (0 = today, 1 = 5+ years) on a log scale. */
export function freshness(iso: string | null, now = Date.now()) {
  if (!iso) return { days: null, bucket: 'never' as Freshness, position: 1 }
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / DAY))
  const bucket: Freshness = days <= 30 ? 'fresh' : days <= 180 ? 'aging' : 'dormant'
  return { days, bucket, position: Math.min(1, Math.log1p(days) / Math.log1p(SPAN_DAYS)) }
}

export function tickPosition(days: number) {
  return Math.log1p(days) / Math.log1p(SPAN_DAYS)
}

export function useRelativeTime() {
  const { t } = useI18n()
  return (days: number | null) => {
    if (days === null) return t('fresh.never')
    if (days < 1) return t('fresh.today')
    if (days < 30) return t('fresh.days', { n: days })
    if (days < 365) return t('fresh.months', { n: Math.floor(days / 30) })
    return t('fresh.years', { n: Math.floor(days / 365) })
  }
}

/** Incremented after a scan so open views reload. */
export const scanTick = ref(0)

/**
 * Remembers some query parameters of a page per browser: when the user comes back to the page
 * without any of them in the URL, the saved ones are restored. `reset()` clears both.
 */
export function useSavedQuery(storageKey: string, keys: string[]) {
  const route = useRoute()
  const router = useRouter()
  const pick = (query: Record<string, unknown>) =>
    Object.fromEntries(keys.filter((k) => typeof query[k] === 'string' && query[k] !== '').map((k) => [k, query[k] as string]))

  const read = (): Record<string, string> => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
      return saved && typeof saved === 'object' ? pick(saved) : {}
    } catch {
      return {}
    }
  }
  const write = (values: Record<string, string>) => {
    try {
      if (Object.keys(values).length) localStorage.setItem(storageKey, JSON.stringify(values))
      else localStorage.removeItem(storageKey)
    } catch {
      // Storage unavailable: filters simply are not remembered.
    }
  }

  // Restore before the page loads its data, only when the URL carries no filters of its own.
  const saved = read()
  const restoring = Object.keys(pick(route.query)).length === 0 && Object.keys(saved).length > 0
  if (restoring) router.replace({ query: { ...route.query, ...saved } })

  // Save on arrival too (a link may carry filters), except while restoring the saved ones.
  watch(
    () => route.query,
    (query) => write(pick(query)),
    { immediate: !restoring },
  )

  function reset() {
    write({})
    const rest = Object.fromEntries(Object.entries(route.query).filter(([k]) => !keys.includes(k)))
    router.replace({ query: rest })
  }

  return { reset, restoring }
}
