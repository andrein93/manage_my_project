<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Overview } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { formatMinutes, formatMoney, formatUsd } from '../time'

const { t } = useI18n()
const { error, report } = useErrors()

const data = ref<Overview | null>(null)
const copied = ref(false)

let latest = 0
async function load() {
  const request = ++latest
  try {
    const o = await api.overview()
    if (request !== latest) return
    data.value = o
    error.value = null
  } catch (e) {
    if (request === latest) report(e)
  }
}

const money = (cents: number) => formatMoney(cents, data.value?.currency ?? 'EUR')
const defaultLabel = (direction: 'pay' | 'invoice') => t(direction === 'pay' ? 'overview.defaultExpense' : 'overview.defaultFee')

/** Projects grouped by health flag, in a fixed order of severity. */
const healthGroups = computed(() => {
  const order = ['missing', 'no_remote', 'no_git', 'unpushed', 'uncommitted', 'dormant'] as const
  const groups = order.map((kind) => ({
    kind,
    projects: (data.value?.attention.health ?? [])
      .filter((h) => h.flags.some((f) => f.kind === kind))
      .map((h) => ({ id: h.projectId, name: h.projectName, count: h.flags.find((f) => f.kind === kind)?.count })),
  }))
  return groups.filter((g) => g.projects.length)
})

const allClear = computed(() => {
  const a = data.value?.attention
  return !!a && !a.overdueTasks.length && !a.health.length && !a.owed.length && !a.upcoming.length
})

const maxMinutes = computed(() => Math.max(1, ...(data.value?.week.topProjects.map((p) => p.minutes) ?? [1])))

/** Weekly report as Markdown, in the interface language. */
async function copyDigest() {
  try {
    const d = await api.digest('this')
    const m = (c: number) => formatMoney(c, d.currency)
    const lines = [
      `# ${t('overview.digestTitle', { from: d.from, to: d.to })}`,
      '',
      `- **${t('time.total')}:** ${formatMinutes(d.minutes)}`,
      `- **${t('time.aiCost')}:** ${formatUsd(d.costUsd)}`,
      `- **${t('finance.earned')}:** ${m(d.earnedCents)}, **${t('finance.collected')}:** ${m(d.collectedCents)}`,
      `- **${t('finance.owedTitle')}:** ${m(d.owedCents)}`,
      `- **${t('overview.overdue')}:** ${d.overdueTasks}`,
    ]
    if (d.topProjects.length) lines.push('', `## ${t('overview.topProjects')}`, ...d.topProjects.map((p) => `- ${p.name}: ${formatMinutes(p.minutes)}`))
    if (d.tasksCompleted.length) lines.push('', `## ${t('overview.done')}`, ...d.tasksCompleted.map((x) => `- ${x.title} (${x.projectName})`))
    const kinds = Object.keys(d.health)
    if (kinds.length) lines.push('', `## ${t('overview.attention')}`, ...kinds.map((k) => `- ${t(`health.${k}`)}: ${d.health[k].join(', ')}`))
    if (d.upcoming.length) {
      lines.push(
        '',
        `## ${t('overview.upcoming')}`,
        ...d.upcoming.map((u) => `- ${u.date}: ${t(`overview.${u.direction}`)} ${m(u.amountCents)}, ${u.label || defaultLabel(u.direction)}${u.projectName ? ` (${u.projectName})` : ''}`),
      )
    }
    await navigator.clipboard.writeText(lines.join('\n') + '\n')
    copied.value = true
    setTimeout(() => (copied.value = false), 2500)
  } catch (e) {
    report(e)
  }
}

useAutoRefresh(load, 60_000)
</script>

<template>
  <section>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">{{ t('app.overview') }}</h1>
      <button class="btn" @click="copyDigest">{{ copied ? t('overview.copied') : t('overview.copyDigest') }}</button>
    </div>
    <p v-if="error" class="mb-4 text-sm text-danger" role="alert">{{ error }}</p>

    <template v-if="data">
      <div class="grid gap-10 lg:grid-cols-2">
        <section>
          <h2 class="mb-3 text-sm font-semibold text-muted">{{ t('overview.thisWeek') }} <span class="font-normal tabular-nums">{{ data.week.from }} → {{ data.week.to }}</span></h2>
          <dl class="grid grid-cols-3 gap-4">
            <div>
              <dt class="text-sm text-muted">{{ t('time.total') }}</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ formatMinutes(data.week.minutes) }}</dd>
            </div>
            <div :title="t('time.aiCostHint')">
              <dt class="text-sm text-muted">{{ t('time.aiCost') }}</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ formatUsd(data.week.costUsd) }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">{{ t('overview.tasksDone') }}</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ data.week.tasksCompleted }}</dd>
            </div>
          </dl>
          <ul v-if="data.week.topProjects.length" class="mt-4 space-y-1.5 text-sm">
            <li v-for="p in data.week.topProjects" :key="p.id" class="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-3">
              <RouterLink :to="{ name: 'project', params: { id: p.id } }" class="truncate hover:underline">{{ p.name }}</RouterLink>
              <div class="h-2 rounded-sm bg-line/50"><div class="h-2 rounded-sm bg-chart" :style="{ width: `${(p.minutes / maxMinutes) * 100}%` }" /></div>
              <span class="text-right tabular-nums">{{ formatMinutes(p.minutes) }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h2 class="mb-3 text-sm font-semibold text-muted">{{ t('overview.thisMonth') }}</h2>
          <dl class="grid grid-cols-3 gap-4">
            <div>
              <dt class="text-sm text-muted">{{ t('finance.earned') }}</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ money(data.month.earnedCents) }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">{{ t('finance.collected') }}</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums">{{ money(data.month.collectedCents) }}</dd>
            </div>
            <div>
              <dt class="text-sm text-muted">{{ t('finance.margin') }}</dt>
              <dd class="text-2xl font-semibold tracking-tight tabular-nums" :class="{ 'text-danger': data.month.marginCents < 0 }">{{ money(data.month.marginCents) }}</dd>
            </div>
          </dl>
          <RouterLink to="/finance" class="mt-3 inline-block text-sm text-muted hover:text-ink">{{ t('overview.seeFinance') }}</RouterLink>
        </section>
      </div>

      <h2 class="mt-12 mb-4 text-lg font-semibold">{{ t('overview.attention') }}</h2>
      <p v-if="allClear" class="border-y border-line py-8 text-center text-sm text-muted">{{ t('overview.allClear') }}</p>

      <div class="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <section v-if="data.attention.overdueTasks.length">
          <h3 class="mb-1 text-sm font-semibold text-danger">{{ t('overview.overdue') }} <span class="font-normal tabular-nums">{{ data.attention.overdueTasks.length }}</span></h3>
          <ul class="divide-y divide-line border-y border-line text-sm">
            <li v-for="task in data.attention.overdueTasks.slice(0, 8)" :key="task.id" class="flex items-baseline justify-between gap-3 py-2">
              <span class="min-w-0">
                <span class="block truncate">{{ task.title }}</span>
                <RouterLink :to="{ name: 'project', params: { id: task.projectId } }" class="text-xs text-muted hover:text-ink">{{ task.projectName }}</RouterLink>
              </span>
              <span class="shrink-0 text-xs text-danger tabular-nums">{{ task.dueDate }}</span>
            </li>
          </ul>
          <RouterLink v-if="data.attention.overdueTasks.length > 8" to="/tasks" class="mt-1 inline-block text-xs text-muted hover:text-ink">{{ t('overview.seeAll') }}</RouterLink>
        </section>

        <section v-if="healthGroups.length">
          <h3 class="mb-1 text-sm font-semibold">{{ t('overview.health') }}</h3>
          <ul class="divide-y divide-line border-y border-line text-sm">
            <li v-for="g in healthGroups" :key="g.kind" class="py-2">
              <p class="font-medium" :class="{ 'text-danger': g.kind === 'missing' || g.kind === 'no_remote' }">{{ t(`health.${g.kind}`) }}</p>
              <p class="mt-0.5 text-xs text-muted">
                <template v-for="(p, i) in g.projects" :key="p.id">
                  <template v-if="i">, </template>
                  <RouterLink :to="{ name: 'project', params: { id: p.id } }" class="hover:text-ink hover:underline">{{ p.name }}</RouterLink>
                  <template v-if="p.count"> ({{ p.count }})</template>
                </template>
              </p>
            </li>
          </ul>
        </section>

        <section v-if="data.attention.owed.length">
          <h3 class="mb-1 text-sm font-semibold">{{ t('finance.owedTitle') }}</h3>
          <ul class="divide-y divide-line border-y border-line text-sm">
            <li v-for="o in data.attention.owed" :key="o.clientId" class="flex justify-between gap-3 py-2">
              <RouterLink v-if="o.clientId !== 'none'" :to="{ name: 'client', params: { id: o.clientId } }" class="hover:underline">{{ o.clientName }}</RouterLink>
              <span v-else>{{ t('list.noClient') }}</span>
              <span class="font-medium tabular-nums">{{ money(o.owedCents) }}</span>
            </li>
          </ul>
        </section>

        <section v-if="data.attention.upcoming.length">
          <h3 class="mb-1 text-sm font-semibold">{{ t('overview.upcoming') }}</h3>
          <ul class="divide-y divide-line border-y border-line text-sm">
            <li v-for="(u, i) in data.attention.upcoming" :key="i" class="flex items-baseline justify-between gap-3 py-2">
              <span class="min-w-0">
                <span class="tabular-nums">{{ u.date }}</span>
                <span class="ml-2">{{ u.label || defaultLabel(u.direction) }}</span>
                <span class="ml-1 text-xs text-muted">{{ u.projectName ?? t('finance.sharedExpenses') }}</span>
              </span>
              <span class="shrink-0 tabular-nums" :class="u.direction === 'invoice' ? 'text-fresh' : ''">
                {{ t(`overview.${u.direction}`) }} {{ money(u.amountCents) }}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>
