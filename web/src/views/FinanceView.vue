<script setup lang="ts">
import { Wallet } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { api, type FinanceReport, type FinanceRow, type OwedRow } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { formatMinutes, formatMoney } from '../time'
import PageHeader from '../ui/PageHeader.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiStat from '../ui/UiStat.vue'
import StatementList from '../components/StatementList.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { error, report: reportError } = useErrors()

const PERIODS = ['month', 'last-month', 'week', 'last-week', 'today', 'lifetime'] as const
type SortKey = 'label' | 'minutes' | 'earnedCents' | 'costCents' | 'marginCents' | 'effectiveRateCents'

const report = ref<FinanceReport | null>(null)
const owed = ref<{ currency: string; rows: OwedRow[] } | null>(null)
const sort = ref<{ key: SortKey; desc: boolean }>({ key: 'marginCents', desc: true })

const q = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const period = computed(() => q('period') || 'month')
const by = computed(() => (q('by') === 'client' ? 'client' : 'project'))
const tab = computed(() => (q('tab') === 'statements' ? 'statements' : 'report'))
const setQuery = (patch: Record<string, string | undefined>) => router.replace({ query: { ...route.query, ...patch } })

let latest = 0
async function load() {
  const request = ++latest
  try {
    const params = period.value === 'lifetime' ? { lifetime: 'true', by: by.value } : { period: period.value, by: by.value }
    const [r, o] = await Promise.all([api.financeReport(params), api.owed()])
    if (request !== latest) return
    report.value = r
    owed.value = o
    error.value = null
  } catch (e) {
    if (request === latest) reportError(e)
  }
}

const money = (cents: number | null) => formatMoney(cents, report.value?.currency ?? 'EUR')
/** Rows without revenue only carry a share of costs; they are folded into one summary line. */
const hasMoney = (r: FinanceRow) => r.earnedCents !== 0 || r.collectedCents !== 0
const showAll = ref(false)
const minor = computed(() => (report.value?.rows ?? []).filter((r) => !hasMoney(r)))
const minorTotals = computed(() => ({
  count: minor.value.length,
  minutes: minor.value.reduce((s, r) => s + r.minutes, 0),
  costCents: minor.value.reduce((s, r) => s + r.costCents, 0),
}))
const rows = computed(() => {
  const list = (report.value?.rows ?? []).filter((r) => showAll.value || hasMoney(r))
  const { key, desc } = sort.value
  return list.sort((a: FinanceRow, b: FinanceRow) => {
    const av = a[key] ?? -Infinity
    const bv = b[key] ?? -Infinity
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return desc ? -cmp : cmp
  })
})
function sortBy(key: SortKey) {
  sort.value = sort.value.key === key ? { key, desc: !sort.value.desc } : { key, desc: key !== 'label' }
}
const ariaSort = (key: SortKey) => (sort.value.key === key ? (sort.value.desc ? 'descending' : 'ascending') : 'none')
const columns: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'label', label: 'time.name', numeric: false },
  { key: 'minutes', label: 'finance.hours', numeric: true },
  { key: 'earnedCents', label: 'finance.earned', numeric: true },
  { key: 'costCents', label: 'finance.costs', numeric: true },
  { key: 'marginCents', label: 'finance.margin', numeric: true },
  { key: 'effectiveRateCents', label: 'finance.perHour', numeric: true },
]
const link = (key: string) =>
  by.value === 'project' ? { name: 'project', params: { id: key } } : key !== 'none' ? { name: 'client', params: { id: key } } : null

watch(
  () => route.query,
  () => {
    report.value = null
    load()
  },
)
useAutoRefresh(load, 60_000)
const moneyTick = (n: number) => money(Math.round(n))
</script>

<template>
  <section>
    <PageHeader :title="t('app.finance')">
      <template #actions>
        <div class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="tablist">
          <button
            v-for="x in ['report', 'statements'] as const"
            :key="x"
            type="button"
            role="tab"
            class="rounded-md px-3 py-1 transition-colors"
            :class="tab === x ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
            :aria-selected="tab === x"
            @click="setQuery({ tab: x === 'report' ? undefined : x })"
          >
            {{ x === 'report' ? t('statement.report') : t('statement.title') }}
          </button>
        </div>
      </template>
    </PageHeader>

    <StatementList v-if="tab === 'statements'" show-client />
    <template v-else>

    <div class="mb-6 flex flex-wrap items-center gap-2">
      <select class="field !w-auto" :value="period" :aria-label="t('a11y.period')" @change="setQuery({ period: ($event.target as HTMLSelectElement).value === 'month' ? undefined : ($event.target as HTMLSelectElement).value })">
        <option v-for="p in PERIODS" :key="p" :value="p">{{ p === 'lifetime' ? t('finance.lifetime') : t(`time.period.${p}`) }}</option>
      </select>
      <div class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="group">
        <button
          v-for="g in ['project', 'client'] as const"
          :key="g"
          type="button"
          class="rounded-md px-3 py-1 transition-colors"
          :class="by === g ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'"
          :aria-pressed="by === g"
          @click="setQuery({ by: g === 'project' ? undefined : g })"
        >
          {{ g === 'project' ? t('finance.byProject') : t('finance.byClient') }}
        </button>
      </div>
      <span v-if="report" class="font-mono text-xs text-muted">{{ report.range.from }} → {{ report.range.to }}</span>
    </div>

    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <template v-if="report">
      <UiCard spotlight as="dl" class="mb-8 grid grid-cols-2 gap-x-8 gap-y-4 p-5 sm:grid-cols-5">
        <UiStat :label="t('finance.earned')" :value="report.totals.earnedCents" :format="moneyTick" :hint="t('finance.earnedHint')" />
        <UiStat :label="t('finance.collected')" :value="report.totals.collectedCents" :format="moneyTick" />
        <UiStat :label="t('finance.costs')" :value="report.totals.costCents" :format="moneyTick" />
        <UiStat :label="t('finance.margin')" :value="report.totals.marginCents" :format="moneyTick" :tone="report.totals.marginCents < 0 ? 'danger' : 'default'" />
        <div :title="t('finance.perHourHint')">
          <dt class="label">{{ t('finance.perHour') }}</dt>
          <dd class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">
            {{ report.totals.effectiveRateCents === null ? '-' : money(report.totals.effectiveRateCents) }}
          </dd>
          <dd class="text-xs text-muted">{{ formatMinutes(report.totals.minutes) }}</dd>
        </div>
      </UiCard>
      <p v-if="report.totals.overheadCents" class="-mt-4 mb-6 text-xs text-muted">
        {{ t('finance.overhead', { amount: money(report.totals.overheadCents) }) }}
      </p>

      <div v-if="rows.length || minorTotals.count" class="mb-12">
        <UiCard class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-sm">
          <thead class="border-b border-line text-left text-xs tracking-wider text-muted uppercase">
            <tr>
              <th v-for="c in columns" :key="c.key" class="px-4 py-2.5 font-medium" :class="{ 'text-right': c.numeric }" :aria-sort="ariaSort(c.key)">
                <button type="button" class="tracking-wider uppercase hover:text-ink" @click="sortBy(c.key)">
                  {{ t(c.label) }}<span v-if="sort.key === c.key" aria-hidden="true"> {{ sort.desc ? '↓' : '↑' }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="r in rows" :key="r.key" class="transition-colors hover:bg-surface-2/60">
              <td class="px-4 py-2.5">
                <RouterLink v-if="link(r.key)" :to="link(r.key)!" class="hover:underline">{{ r.label }}</RouterLink>
                <span v-else>{{ t('list.noClient') }}</span>
              </td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ formatMinutes(r.minutes) }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ money(r.earnedCents) }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums" :title="`${t('finance.ai')} ${money(r.aiCents)}, ${t('finance.expenses')} ${money(r.expenseCents)}`">
                {{ money(r.costCents) }}
              </td>
              <td class="px-4 py-2.5 text-right font-medium tabular-nums" :class="{ 'text-danger': r.marginCents < 0 }">{{ money(r.marginCents) }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ r.effectiveRateCents === null ? '-' : money(r.effectiveRateCents) }}</td>
            </tr>
          </tbody>
        </table>
        </UiCard>
        <button v-if="minorTotals.count" type="button" class="mt-2 text-sm text-muted hover:text-ink" @click="showAll = !showAll">
          {{ showAll ? t('finance.hideMinor') : t('finance.showMinor', { n: minorTotals.count, hours: formatMinutes(minorTotals.minutes), costs: money(minorTotals.costCents) }) }}
        </button>
      </div>
      <UiEmpty v-else class="mb-12" :icon="Wallet" :title="t('finance.empty')" />

      <UiCard as="section" class="max-w-3xl p-5">
        <h2 class="text-lg font-semibold">{{ t('finance.owedTitle') }}</h2>
        <p class="mt-1 text-sm text-muted">{{ t('finance.owedHint') }}</p>
        <ul v-if="owed?.rows.length" class="mt-3 divide-y divide-line text-sm">
          <li v-for="o in owed.rows" :key="o.clientId" class="py-2.5">
            <div class="flex items-baseline justify-between gap-3">
              <RouterLink v-if="o.clientId !== 'none'" :to="{ name: 'client', params: { id: o.clientId } }" class="font-medium hover:underline">{{ o.clientName }}</RouterLink>
              <span v-else class="font-medium">{{ t('list.noClient') }}</span>
              <span class="font-medium tabular-nums" :class="{ 'text-fresh': o.owedCents < 0 }">
                {{ o.owedCents < 0 ? `${t('finance.credit')} ${formatMoney(-o.owedCents, owed.currency)}` : formatMoney(o.owedCents, owed.currency) }}
              </span>
            </div>
            <p class="mt-0.5 text-xs text-muted">
              <template v-for="(p, i) in o.projects.filter((x) => x.owedCents !== 0)" :key="p.id">
                <template v-if="i">, </template>{{ p.name }} {{ formatMoney(p.owedCents, owed.currency) }}
              </template>
            </p>
          </li>
        </ul>
        <p v-else class="mt-3 text-sm text-muted">{{ t('finance.owedNone') }}</p>
      </UiCard>
    </template>
    </template>
  </section>
</template>
