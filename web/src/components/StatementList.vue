<script setup lang="ts">
import { FileText } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Statement } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import { formatMoney } from '../time'
import UiBadge from '../ui/UiBadge.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'
import StaggerItem from '../ui/effects/StaggerItem.vue'

const props = defineProps<{ clientId?: string; showClient?: boolean }>()
const { t } = useI18n()
const { error, report } = useErrors()
const list = ref<Statement[]>([])
const loaded = ref(false)

async function load() {
  try {
    list.value = await api.statements({ client: props.clientId })
    error.value = null
  } catch (e) {
    report(e)
  } finally {
    loaded.value = true
  }
}
watch(() => props.clientId, load)
useAutoRefresh(load)

const tone = (s: Statement) =>
  s.overdue ? 'danger' : ({ draft: 'neutral', issued: 'accent', paid: 'fresh', void: 'dormant' } as const)[s.status]
const label = (s: Statement) => (s.overdue ? t('statement.status.overdue') : t(`statement.status.${s.status}`))
</script>

<template>
  <div>
    <p v-if="error" class="mb-3 text-sm text-danger" role="alert">{{ error }}</p>
    <UiCard v-if="list.length" as="ul" class="divide-y divide-line overflow-hidden">
      <StaggerItem v-for="(s, i) in list" :key="s.id" :index="i" as="li">
        <RouterLink
          :to="{ name: 'statement', params: { id: s.id } }"
          class="grid gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:grid-cols-[9rem_minmax(0,1fr)_12rem_8rem_7rem] sm:items-center"
        >
          <span class="font-mono text-sm">{{ s.number ?? t('statement.draft') }}</span>
          <span class="min-w-0 truncate">
            <template v-if="showClient">{{ s.clientName }}</template>
          </span>
          <span class="font-mono text-xs text-muted">{{ s.periodFrom }} → {{ s.periodTo }}</span>
          <span class="text-right font-medium tabular-nums">{{ formatMoney(s.totalCents, s.currency) }}</span>
          <UiBadge :tone="tone(s)" class="justify-self-start sm:justify-self-end">{{ label(s) }}</UiBadge>
        </RouterLink>
      </StaggerItem>
    </UiCard>
    <!-- On a client page the "New statement" button sits right above: no empty state needed. -->
    <UiEmpty v-else-if="loaded && !error && !clientId" :icon="FileText" :title="t('statement.empty')" />
  </div>
</template>
