import { onBeforeUnmount, onMounted, ref } from 'vue'
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
