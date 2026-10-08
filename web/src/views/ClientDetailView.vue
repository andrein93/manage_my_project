<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type Client, type FinanceReport, type Project, type TimeReport } from '../api'
import CategoryDot from '../components/CategoryDot.vue'
import FreshnessStrip from '../components/FreshnessStrip.vue'
import StatusMark from '../components/StatusMark.vue'
import { useAutoRefresh, useErrors } from '../composables'
import { formatMinutes, formatMoney, formatUsd } from '../time'
import PageHeader from '../ui/PageHeader.vue'
import UiCard from '../ui/UiCard.vue'
import UiSkeleton from '../ui/UiSkeleton.vue'
import StaggerItem from '../ui/effects/StaggerItem.vue'

const props = defineProps<{ id: string }>()
const { t } = useI18n()
const router = useRouter()
const { error, report } = useErrors()

const client = ref<Client | null>(null)
const projects = ref<Project[]>([])
const form = ref({ name: '', email: '', notes: '' })
const saved = ref(false)
const confirmRemove = ref(false)
const month = ref<TimeReport | null>(null)
const lifetime = ref<FinanceReport | null>(null)

const dirty = computed(
  () =>
    !!client.value &&
    (form.value.name !== client.value.name || form.value.email !== client.value.email || form.value.notes !== client.value.notes),
)

async function load(force = false) {
  if (dirty.value && !force) return
  const id = props.id
  try {
    const data = await api.client(id)
    if (id !== props.id || (dirty.value && !force)) return
    loadMonth(id)
    const { projects: list, ...rest } = data
    client.value = rest
    projects.value = list
    form.value = { name: rest.name, email: rest.email, notes: rest.notes }
  } catch (e) {
    report(e)
  }
}

/** Time and money are optional on this page: a failure here must not hide the client. */
async function loadMonth(id: string) {
  // Independent: a failure in one block must not hide the other.
  const [time, money] = await Promise.allSettled([
    api.timeReport({ period: 'month', client: id }),
    api.financeReport({ lifetime: 'true', client: id }),
  ])
  if (id !== props.id) return
  month.value = time.status === 'fulfilled' ? time.value : null
  lifetime.value = money.status === 'fulfilled' ? money.value : null
}

async function save() {
  if (!client.value) return
  try {
    const updated = await api.updateClient(client.value.id, form.value)
    client.value = updated
    form.value = { name: updated.name, email: updated.email, notes: updated.notes }
    error.value = null
    saved.value = true
    setTimeout(() => (saved.value = false), 3000)
  } catch (e) {
    report(e)
  }
}

async function remove() {
  if (!confirmRemove.value) {
    confirmRemove.value = true
    return
  }
  try {
    await api.removeClient(props.id)
    router.push({ name: 'clients' })
  } catch (e) {
    report(e)
  }
}

watch(
  () => props.id,
  () => load(true),
)
useAutoRefresh(() => load())
</script>

<template>
  <div class="max-w-4xl">
    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <div v-if="!client && !error" class="space-y-4">
      <UiSkeleton class="h-8 w-1/3" />
      <UiSkeleton class="h-40" />
    </div>

    <template v-if="client">
      <PageHeader :title="client.name">
        <template #before>
          <RouterLink to="/clients" class="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ArrowLeft class="size-3.5" aria-hidden="true" /> {{ t('clients.back') }}
          </RouterLink>
        </template>
      </PageHeader>
      <p v-if="month" class="-mt-4 mb-6 text-sm text-muted">
        {{ t('time.thisMonth') }}: <span class="text-ink tabular-nums">{{ formatMinutes(month.totals.minutes) }}</span>,
        {{ t('time.aiCost') }} <span class="text-ink tabular-nums">{{ formatUsd(month.totals.costUsd) }}</span>
      </p>

      <dl v-if="lifetime && (lifetime.totals.earnedCents || lifetime.totals.collectedCents || lifetime.totals.costCents)" class="card mb-4 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div>
          <dt class="label">{{ t('finance.earned') }} ({{ t('finance.lifetimeTitle').toLowerCase() }})</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums">{{ formatMoney(lifetime.totals.earnedCents, lifetime.currency) }}</dd>
        </div>
        <div>
          <dt class="label">{{ lifetime.totals.earnedCents - lifetime.totals.collectedCents < 0 ? t('finance.credit') : t('finance.owed') }}</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums">
            {{ formatMoney(Math.abs(lifetime.totals.earnedCents - lifetime.totals.collectedCents), lifetime.currency) }}
          </dd>
        </div>
        <div>
          <dt class="label">{{ t('finance.margin') }}</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums" :class="{ 'text-danger': lifetime.totals.marginCents < 0 }">
            {{ formatMoney(lifetime.totals.marginCents, lifetime.currency) }}
          </dd>
        </div>
        <div>
          <dt class="label">{{ t('finance.perHour') }}</dt>
          <dd class="mt-1 text-xl font-semibold tracking-tight tabular-nums">
            {{ lifetime.totals.effectiveRateCents === null ? '-' : formatMoney(lifetime.totals.effectiveRateCents, lifetime.currency) }}
          </dd>
        </div>
      </dl>

      <UiCard as="form" class="space-y-5 p-5" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium">{{ t('clients.name') }}</span>
            <input v-model="form.name" class="field" required maxlength="200" />
          </label>
          <label class="block">
            <span class="mb-1.5 block text-sm font-medium">{{ t('clients.email') }}</span>
            <input v-model="form.email" type="email" class="field" maxlength="320" />
          </label>
        </div>
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('clients.notes') }}</span>
          <textarea v-model="form.notes" class="field min-h-28" maxlength="20000" :placeholder="t('clients.notesHint')" />
        </label>
        <div class="flex items-center gap-3">
          <button class="btn btn-primary" :disabled="!dirty">{{ t('detail.save') }}</button>
          <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
        </div>
      </UiCard>

      <h2 class="mt-10 mb-3 text-lg font-semibold">{{ t('clients.projects') }}</h2>
      <UiCard v-if="projects.length" spotlight as="ul" class="divide-y divide-line overflow-hidden">
        <StaggerItem v-for="(p, i) in projects" :key="p.id" :index="i" as="li">
          <RouterLink
            :to="{ name: 'project', params: { id: p.id } }"
            class="grid gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_11rem_7rem] sm:items-center"
          >
            <span class="flex min-w-0 items-center gap-2 font-medium">
              <CategoryDot :category="p.category" reserve />
              <span class="truncate">{{ p.name }}</span>
            </span>
            <FreshnessStrip :at="p.lastActivityAt" />
            <StatusMark :status="p.status" class="justify-self-start" />
          </RouterLink>
        </StaggerItem>
      </UiCard>
      <p v-else class="text-sm text-muted">{{ t('clients.noProjects') }}</p>

      <div class="mt-10 rounded-lg border border-danger/20 p-5">
        <button class="btn btn-danger" :class="{ '!border-danger': confirmRemove }" @click="remove">
          {{ confirmRemove ? t('clients.removeConfirm') : t('clients.remove') }}
        </button>
        <p class="mt-2 text-sm text-muted">{{ t('clients.removeHint') }}</p>
      </div>
    </template>
  </div>
</template>
