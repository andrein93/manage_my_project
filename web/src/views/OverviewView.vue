<script setup lang="ts">
import { Motion } from 'motion-v'
import { ArrowRight, Check, ClipboardCopy, PartyPopper } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Digest, type Overview } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { reducedMotion, staggerDelay } from '../motion'
import { formatMinutes, formatMoney, formatUsd } from '../time'
import PageHeader from '../ui/PageHeader.vue'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import UiSkeleton from '../ui/UiSkeleton.vue'
import UiStat from '../ui/UiStat.vue'
import BorderBeam from '../ui/effects/BorderBeam.vue'
import DotGrid from '../ui/effects/DotGrid.vue'
import StaggerItem from '../ui/effects/StaggerItem.vue'

const { t } = useI18n()
const { error, report } = useErrors()

const data = ref<Overview | null>(null)
const digestData = ref<Digest | null>(null)
const copied = ref(false)

let latest = 0
async function load() {
  const request = ++latest
  try {
    const [o, d] = await Promise.all([api.overview(), api.digest('this')])
    if (request !== latest) return
    data.value = o
    digestData.value = d
    error.value = null
  } catch (e) {
    if (request === latest) report(e)
  }
}

const money = (cents: number) => formatMoney(cents, data.value?.currency ?? 'EUR')
const moneyTick = (n: number) => money(Math.round(n))
const minutesTick = (n: number) => formatMinutes(Math.round(n))
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

/** Weekly report as Markdown, in the interface language (built from prefetched data so the
 * clipboard write stays inside the click, as Safari and Firefox require). */
function copyDigest() {
  const d = digestData.value
  if (!d) return
  try {
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
    writeClipboard(lines.join('\n') + '\n')
    copied.value = true
    setTimeout(() => (copied.value = false), 2500)
  } catch (e) {
    report(e)
  }
}

function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
  } else legacyCopy(text)
}

/** Works without the async clipboard API (e.g. plain HTTP on a LAN address). */
function legacyCopy(text: string) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

useAutoRefresh(load, 60_000)
</script>

<template>
  <section class="relative isolate">
    <DotGrid />
    <PageHeader :title="t('app.overview')">
      <template #actions>
        <UiButton :icon="copied ? Check : ClipboardCopy" :disabled="!digestData" @click="copyDigest">{{ copied ? t('overview.copied') : t('overview.copyDigest') }}</UiButton>
      </template>
    </PageHeader>
    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div v-if="!data && !error" class="grid gap-4 lg:grid-cols-2">
      <UiSkeleton class="h-56" />
      <UiSkeleton class="h-56" />
    </div>

    <template v-if="data">
      <div class="grid gap-4 lg:grid-cols-2">
        <UiCard spotlight as="section" class="overflow-hidden p-5">
          <BorderBeam />
          <h2 class="label mb-4">
            {{ t('overview.thisWeek') }} <span class="ml-1 font-mono tracking-normal normal-case">{{ data.week.from }} → {{ data.week.to }}</span>
          </h2>
          <dl class="grid grid-cols-3 gap-4">
            <UiStat :label="t('time.total')" :value="data.week.minutes" :format="minutesTick" />
            <UiStat :label="t('time.aiCost')" :value="data.week.costUsd" :format="formatUsd" :hint="t('time.aiCostHint')" />
            <UiStat :label="t('overview.tasksDone')" :value="data.week.tasksCompleted" />
          </dl>
          <ul v-if="data.week.topProjects.length" class="mt-6 space-y-2.5 text-sm">
            <StaggerItem
              v-for="(p, i) in data.week.topProjects"
              :key="p.id"
              :index="i"
              as="li"
              class="grid grid-cols-[minmax(0,10rem)_1fr_4.5rem] items-center gap-3"
            >
              <RouterLink :to="{ name: 'project', params: { id: p.id } }" class="truncate hover:text-action">{{ p.name }}</RouterLink>
              <div class="h-1.5 rounded-full bg-surface-2">
                <Motion
                  class="h-1.5 w-full origin-left rounded-full bg-chart"
                  :initial="{ scaleX: 0 }"
                  :animate="{ scaleX: p.minutes / maxMinutes }"
                  :transition="{ duration: 0.6, ease: 'easeOut', delay: staggerDelay(i, reducedMotion) }"
                />
              </div>
              <span class="text-right font-mono text-xs text-muted">{{ formatMinutes(p.minutes) }}</span>
            </StaggerItem>
          </ul>
        </UiCard>

        <UiCard spotlight as="section" class="p-5">
          <h2 class="label mb-4">{{ t('overview.thisMonth') }}</h2>
          <dl class="grid grid-cols-3 gap-4">
            <UiStat :label="t('finance.earned')" :value="data.month.earnedCents" :format="moneyTick" />
            <UiStat :label="t('finance.collected')" :value="data.month.collectedCents" :format="moneyTick" />
            <UiStat :label="t('finance.margin')" :value="data.month.marginCents" :format="moneyTick" :tone="data.month.marginCents < 0 ? 'danger' : 'default'" />
          </dl>
          <RouterLink to="/finance" class="mt-6 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            {{ t('overview.seeFinance') }} <ArrowRight class="size-3.5" aria-hidden="true" />
          </RouterLink>
        </UiCard>
      </div>

      <h2 class="mt-12 mb-4 text-lg font-semibold">{{ t('overview.attention') }}</h2>
      <UiEmpty v-if="allClear" :icon="PartyPopper" :title="t('overview.allClear')" />

      <div class="grid gap-4 lg:grid-cols-2">
        <UiCard v-if="data.attention.overdueTasks.length" spotlight as="section" class="p-4">
          <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-danger">
            {{ t('overview.overdue') }} <UiBadge tone="danger">{{ data.attention.overdueTasks.length }}</UiBadge>
          </h3>
          <ul class="divide-y divide-line text-sm">
            <StaggerItem
              v-for="(task, i) in data.attention.overdueTasks.slice(0, 8)"
              :key="task.id"
              :index="i"
              as="li"
              class="flex items-baseline justify-between gap-3 py-2"
            >
              <span class="min-w-0">
                <span class="block truncate">{{ task.title }}</span>
                <RouterLink :to="{ name: 'project', params: { id: task.projectId } }" class="text-xs text-muted hover:text-ink">{{ task.projectName }}</RouterLink>
              </span>
              <span class="shrink-0 font-mono text-xs text-danger">{{ task.dueDate }}</span>
            </StaggerItem>
          </ul>
          <RouterLink v-if="data.attention.overdueTasks.length > 8" to="/tasks" class="mt-2 inline-block text-xs text-muted hover:text-ink">{{ t('overview.seeAll') }}</RouterLink>
        </UiCard>

        <UiCard v-if="healthGroups.length" spotlight as="section" class="p-4">
          <h3 class="mb-2 text-sm font-semibold">{{ t('overview.health') }}</h3>
          <ul class="divide-y divide-line text-sm">
            <StaggerItem v-for="(g, i) in healthGroups" :key="g.kind" :index="i" as="li" class="py-2">
              <p class="font-medium" :class="{ 'text-danger': g.kind === 'missing' || g.kind === 'no_remote' }">{{ t(`health.${g.kind}`) }}</p>
              <p class="mt-0.5 text-xs text-muted">
                <template v-for="(p, j) in g.projects" :key="p.id">
                  <template v-if="j">, </template>
                  <RouterLink :to="{ name: 'project', params: { id: p.id } }" class="hover:text-ink hover:underline">{{ p.name }}</RouterLink>
                  <template v-if="p.count"> ({{ p.count }})</template>
                </template>
              </p>
            </StaggerItem>
          </ul>
        </UiCard>

        <UiCard v-if="data.attention.owed.length" spotlight as="section" class="p-4">
          <h3 class="mb-2 text-sm font-semibold">{{ t('finance.owedTitle') }}</h3>
          <ul class="divide-y divide-line text-sm">
            <StaggerItem v-for="(o, i) in data.attention.owed" :key="o.clientId" :index="i" as="li" class="flex justify-between gap-3 py-2">
              <RouterLink v-if="o.clientId !== 'none'" :to="{ name: 'client', params: { id: o.clientId } }" class="hover:underline">{{ o.clientName }}</RouterLink>
              <span v-else>{{ t('list.noClient') }}</span>
              <span class="font-medium tabular-nums">{{ money(o.owedCents) }}</span>
            </StaggerItem>
          </ul>
        </UiCard>

        <UiCard v-if="data.attention.upcoming.length" spotlight as="section" class="p-4">
          <h3 class="mb-2 text-sm font-semibold">{{ t('overview.upcoming') }}</h3>
          <ul class="divide-y divide-line text-sm">
            <StaggerItem v-for="(u, i) in data.attention.upcoming" :key="i" :index="i" as="li" class="flex items-baseline justify-between gap-3 py-2">
              <span class="min-w-0">
                <span class="font-mono text-xs">{{ u.date }}</span>
                <span class="ml-2">{{ u.label || defaultLabel(u.direction) }}</span>
                <span class="ml-1 text-xs text-muted">{{ u.projectName ?? t('finance.sharedExpenses') }}</span>
              </span>
              <UiBadge :tone="u.direction === 'invoice' ? 'fresh' : 'neutral'">{{ t(`overview.${u.direction}`) }} {{ money(u.amountCents) }}</UiBadge>
            </StaggerItem>
          </ul>
        </UiCard>
      </div>
    </template>
  </section>
</template>
