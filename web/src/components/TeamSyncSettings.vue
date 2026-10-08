<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type TeamMember, type TeamSyncStatus } from '../api'
import { scanTick, useErrors } from '../composables'
import { uiLocale } from '../i18n'

const { t } = useI18n()
const { error, report } = useErrors()

const status = ref<TeamSyncStatus | null>(null)
const members = ref<TeamMember[]>([])
const form = ref({ url: '', token: '' })
const busy = ref(false)
const confirmLogout = ref(false)

async function load() {
  status.value = await api.syncStatus()
  members.value = status.value.configured ? await api.members() : []
}

async function run(action: () => Promise<unknown>) {
  busy.value = true
  try {
    await action()
    error.value = null
    await load()
    scanTick.value++
  } catch (e) {
    report(e)
  } finally {
    busy.value = false
  }
}

const connect = () =>
  run(async () => {
    await api.syncLogin(form.value.url, form.value.token)
    form.value.token = ''
  })
const syncNow = () => run(() => api.syncRun())
function disconnect() {
  if (!confirmLogout.value) {
    confirmLogout.value = true
    return
  }
  confirmLogout.value = false
  run(() => api.syncLogout())
}

const when = (iso: string) => new Date(iso).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' })

onMounted(() => load().catch(report))
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('team.title') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('team.hint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>

    <form v-if="status && !status.configured" class="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" @submit.prevent="connect">
      <input v-model="form.url" class="field" required type="url" placeholder="https://mmp.example.com" :aria-label="t('team.url')" />
      <input v-model="form.token" class="field font-mono" required autocomplete="off" :placeholder="t('team.token')" :aria-label="t('team.token')" />
      <button class="btn btn-primary" :disabled="busy">{{ t('team.connect') }}</button>
      <p class="text-xs text-muted sm:col-span-3">{{ t('team.tokenHint') }}</p>
    </form>

    <div v-else-if="status" class="mt-3 space-y-3 text-sm">
      <dl class="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
        <dt class="text-muted">{{ t('team.server') }}</dt>
        <dd class="break-all">{{ status.url }}</dd>
        <dt class="text-muted">{{ t('team.you') }}</dt>
        <dd>{{ status.user?.name }} <span class="text-muted">{{ status.user?.email }}</span></dd>
        <dt class="text-muted">{{ t('team.lastSync') }}</dt>
        <dd>
          <template v-if="status.lastRun">{{ when(status.lastRun.at) }} ({{ t('team.lastSyncDetail', { received: status.lastRun.applied, sent: status.lastRun.pushed }) }})</template>
          <template v-else>{{ t('team.never') }}</template>
        </dd>
        <dt class="text-muted">{{ t('team.members') }}</dt>
        <dd>{{ members.map((m) => m.name + (m.me ? ` (${t('team.me')})` : '')).join(', ') }}</dd>
      </dl>
      <p v-if="status.lastError" class="text-danger" role="alert">{{ status.lastError }}</p>
      <p class="text-xs text-muted">{{ t('team.shareHint') }}</p>
      <div class="flex gap-2">
        <button class="btn" :disabled="busy || status.running" @click="syncNow">{{ t('team.syncNow') }}</button>
        <button class="btn" :class="{ '!border-danger !text-danger': confirmLogout }" :disabled="busy" @click="disconnect">
          {{ confirmLogout ? t('settings.removeConfirm') : t('team.disconnect') }}
        </button>
      </div>
    </div>
  </section>
</template>
