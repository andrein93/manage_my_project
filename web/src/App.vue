<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { api } from './api'
import { scanTick, useErrors } from './composables'

const { t } = useI18n()
const route = useRoute()
const links = computed(() => [
  { to: '/', label: t('app.projects'), active: (p: string) => p === '/' || p.startsWith('/projects') },
  { to: '/tasks', label: t('app.tasks'), active: (p: string) => p.startsWith('/tasks') },
  { to: '/clients', label: t('app.clients'), active: (p: string) => p.startsWith('/clients') },
  { to: '/settings', label: t('app.settings'), active: (p: string) => p.startsWith('/settings') },
])
const scanning = ref(false)
const notice = ref<string | null>(null)
const { error, report, clear } = useErrors()

async function rescan() {
  scanning.value = true
  clear()
  try {
    const r = await api.scan()
    notice.value = t('app.scanDone', { added: r.added, missing: r.missing, total: r.total })
    scanTick.value++
    setTimeout(() => (notice.value = null), 5000)
  } catch (e) {
    report(e)
  } finally {
    scanning.value = false
  }
}
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-line">
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <RouterLink to="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" class="h-6 w-6" />
          mmp
        </RouterLink>
        <nav class="order-last flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
          <RouterLink
            v-for="link in links"
            :key="link.to"
            :to="link.to"
            class="rounded-md px-3 py-1.5 text-muted hover:text-ink"
            :class="{ '!text-ink bg-surface': link.active(route.path) }"
          >
            {{ link.label }}
          </RouterLink>
        </nav>
        <button class="btn ml-auto" :disabled="scanning" @click="rescan">
          <svg viewBox="0 0 20 20" class="h-4 w-4" :class="{ 'animate-spin': scanning }" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.5v3.5H13" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ scanning ? t('app.scanning') : t('app.rescan') }}
        </button>
      </div>
    </header>

    <div v-if="notice || error" class="mx-auto max-w-6xl px-4 pt-4 sm:px-6" role="status">
      <p v-if="notice" class="text-sm text-muted">{{ notice }}</p>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    </div>

    <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <RouterView />
    </main>
  </div>
</template>
