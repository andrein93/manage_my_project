<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type TimeReport, type WorkBlock } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { uiLocale } from '../i18n'
import { formatMinutes, formatUsd, localDate } from '../time'

const props = defineProps<{ projectId: string }>()
const { t } = useI18n()
const { error, report } = useErrors()

const month = ref<TimeReport | null>(null)
const last30 = ref<TimeReport | null>(null)
const blocks = ref<WorkBlock[]>([])
const team = ref<{ userId: string; name: string; minutes: number }[]>([])

let latest = 0
async function load() {
  const request = ++latest
  const projectId = props.projectId
  const today = new Date()
  const from30 = localDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29))
  try {
    const [m, l, b] = await Promise.all([
      api.timeReport({ period: 'month', project: projectId }),
      api.timeReport({ from: from30, to: localDate(today), project: projectId }),
      api.timeBlocks({ from: from30, to: localDate(today), project: projectId }),
    ])
    // Ignore responses for a project we already navigated away from.
    if (request !== latest || projectId !== props.projectId) return
    month.value = m
    last30.value = l
    blocks.value = b.blocks.slice(0, 5)
    team.value = (await api.teamTime(projectId).catch(() => ({ members: [] }))).members
    error.value = null
  } catch (e) {
    report(e)
  }
}

const when = (iso: string) => new Date(iso).toLocaleString(uiLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

watch(() => props.projectId, load)
useAutoRefresh(load, 60_000)
</script>

<template>
  <section>
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('time.panelTitle') }}</h2>
      <RouterLink to="/time" class="text-sm text-muted hover:text-ink">{{ t('time.seeAll') }}</RouterLink>
    </div>
    <p v-if="error" class="text-sm text-danger" role="alert">{{ error }}</p>
    <dl v-if="month && last30" class="grid grid-cols-3 gap-4">
      <div>
        <dt class="text-sm text-muted">{{ t('time.thisMonth') }}</dt>
        <dd class="text-xl font-semibold tabular-nums">{{ formatMinutes(month.totals.minutes) }}</dd>
      </div>
      <div>
        <dt class="text-sm text-muted">{{ t('time.last30') }}</dt>
        <dd class="text-xl font-semibold tabular-nums">{{ formatMinutes(last30.totals.minutes) }}</dd>
      </div>
      <div :title="t('time.aiCostHint')">
        <dt class="text-sm text-muted">{{ t('time.aiCost') }} ({{ t('time.thisMonth').toLowerCase() }})</dt>
        <dd class="text-xl font-semibold tabular-nums">{{ formatUsd(month.totals.costUsd) }}</dd>
      </div>
    </dl>
    <template v-if="team.length">
      <h3 class="mt-5 mb-1 text-sm font-medium text-muted">{{ t('team.teamTime') }}</h3>
      <ul class="divide-y divide-line border-y border-line text-sm">
        <li v-for="m in team" :key="m.userId" class="flex justify-between gap-3 py-2">
          <span>{{ m.name }}</span>
          <span class="tabular-nums">{{ formatMinutes(m.minutes) }}</span>
        </li>
      </ul>
    </template>
    <h3 class="mt-5 mb-1 text-sm font-medium text-muted">{{ t('time.recentBlocks') }}</h3>
    <ul v-if="blocks.length" class="divide-y divide-line border-y border-line text-sm">
      <li v-for="b in blocks" :key="b.start" class="flex items-center justify-between gap-3 py-2">
        <span>{{ when(b.start) }}</span>
        <span class="flex items-center gap-3">
          <span class="text-xs text-muted">{{ b.sources.map((s) => t(`time.sources.${s}`)).join(', ') }}</span>
          <span class="w-16 text-right tabular-nums">{{ formatMinutes(b.minutes) }}</span>
        </span>
      </li>
    </ul>
    <p v-else class="text-sm text-muted">{{ t('time.noBlocks') }}</p>
  </section>
</template>
