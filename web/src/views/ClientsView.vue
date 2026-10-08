<script setup lang="ts">
import { Users } from 'lucide-vue-next'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type Client } from '../api'
import { useAutoRefresh, useErrors } from '../composables'
import PageHeader from '../ui/PageHeader.vue'
import UiCard from '../ui/UiCard.vue'
import UiEmpty from '../ui/UiEmpty.vue'

const { t } = useI18n()
const router = useRouter()
const { error, report } = useErrors()

const clients = ref<Client[]>([])
const loaded = ref(false)
const name = ref('')

async function load() {
  try {
    clients.value = await api.clients()
  } catch (e) {
    report(e)
  } finally {
    loaded.value = true
  }
}

async function add() {
  try {
    const client = await api.createClient({ name: name.value })
    name.value = ''
    router.push({ name: 'client', params: { id: client.id } })
  } catch (e) {
    report(e)
  }
}

useAutoRefresh(load)
</script>

<template>
  <section class="max-w-4xl">
    <PageHeader :title="t('clients.title')" />

    <form class="mb-6 flex gap-2" @submit.prevent="add">
      <input v-model="name" class="field" required maxlength="200" :placeholder="t('clients.name')" :aria-label="t('clients.name')" />
      <button class="btn btn-primary shrink-0">{{ t('clients.add') }}</button>
    </form>
    <p v-if="error" class="mb-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{{ error }}</p>

    <UiCard v-if="clients.length" spotlight class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead class="border-b border-line text-left text-xs tracking-wider text-muted uppercase">
        <tr>
          <th class="px-4 py-2.5 font-medium">{{ t('clients.name') }}</th>
          <th class="px-4 py-2.5 text-right font-medium">{{ t('clients.projects') }}</th>
          <th class="px-4 py-2.5 text-right font-medium">{{ t('clients.openTasks') }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="c in clients" :key="c.id" class="transition-colors hover:bg-surface-2/60">
          <td class="px-4 py-3">
            <RouterLink :to="{ name: 'client', params: { id: c.id } }" class="font-medium hover:underline">{{ c.name }}</RouterLink>
            <p v-if="c.email" class="text-xs text-muted">{{ c.email }}</p>
          </td>
          <td class="px-4 py-3 text-right tabular-nums">{{ c.projectCount }}</td>
          <td class="px-4 py-3 text-right tabular-nums">{{ c.openTaskCount }}</td>
        </tr>
      </tbody>
    </table>
    </UiCard>
    <UiEmpty v-else-if="loaded && !error" :icon="Users" :title="t('clients.empty')" />
  </section>
</template>
