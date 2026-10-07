<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from './api'
import { scanTick, useErrors } from './composables'

const { t } = useI18n()
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
      <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <RouterLink to="/" class="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" class="h-6 w-6" />
          mmp
        </RouterLink>
        <nav class="flex gap-1 text-sm">
          <RouterLink
            v-for="link in [{ to: '/', label: t('app.projects') }, { to: '/settings', label: t('app.settings') }]"
            :key="link.to"
            :to="link.to"
            class="rounded-md px-3 py-1.5 text-muted hover:text-ink"
            exact-active-class="!text-ink bg-surface"
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
