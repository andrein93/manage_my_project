<script setup lang="ts">
import { Motion } from 'motion-v'
import { Clock, RefreshCw, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type Meta, type Project, type SyncStatus, type TimeEntry, type TimeReport } from '../api'
import DailyChart from '../components/DailyChart.vue'
import { uiLocale } from '../i18n'
import { scanTick, useAutoRefresh, useErrors } from '../composables'
import { formatMinutes, formatUsd, localDate } from '../time'
import { reducedMotion, staggerDelay } from '../motion'
import PageHeader from '../ui/PageHeader.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import NumberTicker from '../ui/effects/NumberTicker.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { error, report: reportError } = useErrors()

const PERIODS = ['today', 'week', 'last-week', 'month', 'last-month', 'custom'] as const
const GROUPS = ['project', 'client', 'category'] as const

const report = ref<TimeReport | null>(null)
const entries = ref<TimeEntry[]>([])
const status = ref<SyncStatus | null>(null)
const meta = ref<Meta | null>(null)
const projects = ref<Project[]>([])

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const filters = computed(() => ({
  period: q('period') || 'week',
  from: q('from'),
  to: q('to'),
  by: (q('by') || 'project') as (typeof GROUPS)[number],
  client: q('client'),
  category: q('category'),
}))
function setQuery(patch: Record<string, string | undefined>) {
  router.replace({ query: { ...route.query, ...patch } })
}
function setPeriod(period: string) {
  if (period === 'custom') {
    const r = report.value?.range
    setQuery({ period: 'custom', from: r?.from ?? localDate(), to: r?.to ?? localDate() })
  } else setQuery({ period: period === 'week' ? undefined : period, from: undefined, to: undefined })
}

const params = computed(() => {
  const f = filters.value
  return {
    // A custom period without a start date falls back to this week.
    ...(f.period === 'custom' ? (f.from ? { from: f.from, to: f.to || f.from } : { period: 'week' }) : { period: f.period }),
    by: f.by,
    client: f.client || undefined,
    category: f.category || undefined,
  }
})

let latest = 0
async function load() {
  const request = ++latest
  try {
    const p = params.value
    const [r, s, m, list] = await Promise.all([
      api.timeReport(p),
      api.timeStatus(),
      api.meta(),
      api.projects({ all: 'true' }),
    ])
    if (request !== latest) return
    report.value = r
    status.value = s
    meta.value = m
    projects.value = list
    const list2 = await api.timeEntries({ from: r.range.from, to: r.range.to })
    if (request !== latest) return
    entries.value = list2
    error.value = null
  } catch (e) {
    reportError(e)
  }
}

// While the first import runs, refresh every few seconds so numbers appear as they land.
let poll: ReturnType<typeof setInterval> | undefined
watch(
  () => status.value?.running,
  (running) => {
    clearInterval(poll)
    if (running) poll = setInterval(load, 3000)
  },
)
onBeforeUnmount(() => clearInterval(poll))

async function syncNow() {
  try {
    await api.timeSync()
    await load()
  } catch (e) {
    reportError(e)
  }
}

// Manual entry form
const form = ref({ projectId: '', minutes: '', date: localDate(), note: '' })
const logged = ref(false)
async function logTime() {
  try {
    await api.addTimeEntry({ ...form.value })
    form.value = { ...form.value, minutes: '', note: '' }
    logged.value = true
    setTimeout(() => (logged.value = false), 3000)
    await load()
  } catch (e) {
    reportError(e)
  }
}
async function removeEntry(id: string) {
  try {
    await api.removeTimeEntry(id)
    await load()
  } catch (e) {
    reportError(e)
  }
}

async function addAsProject(cwd: string) {
  try {
    await api.addProject(cwd)
    scanTick.value++
    await load()
  } catch (e) {
    reportError(e)
  }
}

const maxShare = computed(() => Math.max(0.0001, ...(report.value?.rows.map((r) => r.share) ?? [0])))
const syncedAgo = computed(() => {
  const at = status.value?.lastSync?.finishedAt
  return at ? new Date(at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' }) : null
})
const rowLink = (key: string) =>
  filters.value.by === 'project'
    ? { name: 'project', params: { id: key } }
    : filters.value.by === 'client' && key !== 'none'
      ? { name: 'client', params: { id: key } }
      : null

watch(() => route.query, load)
onMounted(() => {
  if (!form.value.projectId && typeof route.query.project === 'string') form.value.projectId = route.query.project
})
useAutoRefresh(load, 60_000)
const minutesTick = (n: number) => formatMinutes(Math.round(n))
</script>

<template>
  <section>
    <PageHeader :title="t('app.time')">
      <template #actions>
        <span class="text-sm text-muted" role="status">
          <template v-if="status?.running">{{ t('time.syncing') }}</template>
          <template v-else-if="syncedAgo">{{ t('time.syncedAt', { when: syncedAgo }) }}</template>
        </span>
        <button class="btn btn-sm" :disabled="status?.running" @click="syncNow">
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': status?.running }" aria-hidden="true" />{{ t('time.syncNow') }}
        </button>
      </template>
    </PageHeader>

    <p v-if="status?.lastSync && !status.lastSync.claudeDirFound" class="mb-4 rounded-md border border-aging/30 bg-aging/10 px-3 py-2 text-sm">
      {{ t('time.noTranscripts', { dir: status.claudeProjectsDir }) }}
    </p>

    <div class="mb-6 flex flex-wrap items-center gap-2">
      <select class="field !w-auto" :value="filters.period" :aria-label="t('a11y.period')" @change="setPeriod(($event.target as HTMLSelectElement).value)">
        <option v-for="p in PERIODS" :key="p" :value="p">{{ t(`time.period.${p}`) }}</option>
      </select>
      <template v-if="filters.period === 'custom'">
        <input type="date" class="field !w-auto" :value="filters.from" :aria-label="t('time.from')" @change="setQuery({ from: ($event.target as HTMLInputElement).value })" />
        <input type="date" class="field !w-auto" :value="filters.to" :aria-label="t('time.to')" @change="setQuery({ to: ($event.target as HTMLInputElement).value })" />
      </template>
      <select class="field !w-auto" :value="filters.client" :aria-label="t('a11y.client')" @change="setQuery({ client: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">{{ t('list.anyClient') }}</option>
        <option value="none">{{ t('list.noClient') }}</option>
        <option v-for="c in meta?.clients" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <select class="field !w-auto" :value="filters.category" :aria-label="t('a11y.category')" @change="setQuery({ category: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">{{ t('list.anyCategory') }}</option>
        <option value="none">{{ t('list.noCategory') }}</option>
        <option v-for="c in meta?.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <template v-if="report">
      <UiCard class="mb-6 p-5">
      <div class="mb-6 flex flex-wrap gap-x-12 gap-y-4">
        <div>
          <p class="label">{{ t('time.total') }}</p>
          <p class="mt-1 text-3xl font-semibold tracking-tight"><NumberTicker :value="report.totals.minutes" :format="minutesTick" /></p>
          <p v-if="report.totals.manualMinutes" class="text-xs text-muted">
            {{ t('time.manualShare', { manual: formatMinutes(report.totals.manualMinutes) }) }}
          </p>
        </div>
        <div :title="t('time.aiCostHint')">
          <p class="label">{{ t('time.aiCost') }}</p>
          <p class="mt-1 text-3xl font-semibold tracking-tight"><NumberTicker :value="report.totals.costUsd" :format="formatUsd" /></p>
          <p class="text-xs text-muted">{{ t('time.aiCostHint') }}</p>
        </div>
      </div>

      <DailyChart v-if="report.days.length > 1" :days="report.days" />
      </UiCard>

      <div class="mb-3 inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="group">
        <button
          v-for="g in GROUPS"
          :key="g"
          type="button"
          class="rounded-md px-3 py-1 transition-colors"
          :class="filters.by === g ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
          :aria-pressed="filters.by === g"
          @click="setQuery({ by: g === 'project' ? undefined : g })"
        >
          {{ t(`time.by.${g}`) }}
        </button>
      </div>

      <UiCard v-if="report.rows.length" class="mb-10 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-line text-left text-xs tracking-wider text-muted uppercase">
          <tr>
            <th class="py-2.5 pl-4 font-medium">{{ t('time.name') }}</th>
            <th class="hidden w-1/3 py-2.5 font-medium sm:table-cell">{{ t('time.share') }}</th>
            <th class="py-2.5 text-right font-medium">{{ t('time.hours') }}</th>
            <th class="py-2.5 pr-4 text-right font-medium">{{ t('time.aiCost') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="(row, i) in report.rows" :key="row.key" class="transition-colors hover:bg-surface-2/60">
            <td class="py-2.5 pr-3 pl-4">
              <span class="inline-flex items-center gap-2">
                <span v-if="row.color" class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: row.color }" aria-hidden="true" />
                <RouterLink v-if="rowLink(row.key)" :to="rowLink(row.key)!" class="hover:underline">{{ row.label }}</RouterLink>
                <span v-else>{{ row.key === 'none' ? (filters.by === 'client' ? t('list.noClient') : t('list.noCategory')) : row.label }}</span>
              </span>
            </td>
            <td class="hidden py-2.5 pr-6 sm:table-cell">
              <div class="flex items-center gap-2">
                <div class="h-1.5 flex-1 rounded-full bg-surface-2">
                  <Motion
                    class="h-1.5 w-full origin-left rounded-full bg-chart"
                    :initial="{ scaleX: 0 }"
                    :animate="{ scaleX: row.share / maxShare }"
                    :transition="{ duration: 0.6, ease: 'easeOut', delay: staggerDelay(i, reducedMotion) }"
                  />
                </div>
                <span class="w-10 text-right text-xs text-muted tabular-nums">{{ Math.round(row.share * 100) }}%</span>
              </div>
            </td>
            <td class="py-2.5 text-right tabular-nums">{{ formatMinutes(row.minutes) }}</td>
            <td class="py-2.5 pr-4 text-right tabular-nums">{{ formatUsd(row.costUsd) }}</td>
          </tr>
        </tbody>
      </table>
      </UiCard>
      <UiEmpty v-else class="mb-10" :icon="Clock" :title="t('time.empty')" />
      <p v-if="report.rows.length" class="-mt-8 mb-10 text-xs text-muted">{{ t('time.parallelHint') }}</p>

      <section v-if="report.unassigned.length" class="mb-10">
        <h2 class="text-lg font-semibold">{{ t('time.unassigned') }}</h2>
        <p class="mt-1 text-sm text-muted">{{ t('time.unassignedHint') }}</p>
        <ul class="card mt-3 divide-y divide-line px-4">
          <li v-for="u in report.unassigned" :key="u.cwd" class="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <span class="font-mono text-xs break-all">{{ u.cwd }}</span>
            <span class="flex items-center gap-4">
              <span class="tabular-nums">{{ formatMinutes(u.minutes) }}</span>
              <span class="text-muted tabular-nums">{{ formatUsd(u.costUsd) }}</span>
              <button class="btn btn-sm" @click="addAsProject(u.cwd)">{{ t('time.addAsProject') }}</button>
            </span>
          </li>
        </ul>
      </section>

      <UiCard as="section" class="max-w-3xl p-5">
        <h2 class="text-lg font-semibold">{{ t('time.logTime') }}</h2>
        <p class="mt-1 text-sm text-muted">{{ t('time.logTimeHint') }}</p>
        <form class="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_10rem]" @submit.prevent="logTime">
          <select v-model="form.projectId" class="field" required :aria-label="t('time.project')">
            <option value="" disabled>{{ t('task.pickProject') }}</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <input v-model="form.minutes" class="field" required :placeholder="t('time.durationHint')" :aria-label="t('time.duration')" />
          <input v-model="form.date" type="date" class="field" required :aria-label="t('time.date')" />
          <input v-model="form.note" class="field sm:col-span-2" maxlength="2000" :placeholder="t('time.notePlaceholder')" :aria-label="t('time.note')" />
          <div class="flex items-center gap-3">
            <button class="btn btn-primary">{{ t('time.log') }}</button>
            <span v-if="logged" class="text-sm text-fresh" role="status">{{ t('time.logged') }}</span>
          </div>
        </form>

        <template v-if="entries.length">
          <h3 class="label mt-6 mb-2">{{ t('time.entries') }}</h3>
          <ul class="divide-y divide-line text-sm">
            <li v-for="e in entries" :key="e.id" class="flex items-center justify-between gap-3 py-2">
              <span class="min-w-0">
                <span class="tabular-nums">{{ e.date }}</span>
                <span class="mx-2 font-medium">{{ e.projectName }}</span>
                <span class="text-muted">{{ e.note }}</span>
              </span>
              <span class="flex shrink-0 items-center gap-3">
                <span class="tabular-nums">{{ formatMinutes(e.minutes) }}</span>
                <button class="text-muted hover:text-danger" :aria-label="`${t('time.remove')} ${e.date} ${e.projectName}`" @click="removeEntry(e.id)"><X class="size-4" aria-hidden="true" /></button>
              </span>
            </li>
          </ul>
        </template>
      </UiCard>
    </template>
  </section>
</template>
