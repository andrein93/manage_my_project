<script setup lang="ts">
import { BellRing } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api'
import { useErrors } from '../composables'
import UiButton from '../ui/UiButton.vue'

const { t } = useI18n()
const { error, report, clear } = useErrors()
const desktop = ref(false)
const tested = ref<boolean | null>(null)

onMounted(async () => {
  try {
    desktop.value = (await api.settings()).notifications.desktop
  } catch (e) {
    report(e)
  }
})

async function toggle(value: boolean) {
  clear()
  try {
    desktop.value = (await api.updateSettings({ notifications: { desktop: value } })).notifications.desktop
  } catch (e) {
    report(e)
  }
}

async function test() {
  clear()
  tested.value = null
  try {
    tested.value = (await api.testNotification()).sent
  } catch (e) {
    report(e)
  }
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('reminders.settingsTitle') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('reminders.settingsHint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>
    <label class="mt-4 flex items-center gap-3 text-sm">
      <input type="checkbox" class="size-4 accent-[var(--action)]" :checked="desktop" @change="toggle(($event.target as HTMLInputElement).checked)" />
      {{ t('reminders.desktop') }}
    </label>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <UiButton size="sm" :icon="BellRing" @click="test">{{ t('reminders.test') }}</UiButton>
      <span v-if="tested === true" class="text-sm text-fresh" role="status">{{ t('reminders.testSent') }}</span>
      <span v-else-if="tested === false" class="text-sm text-danger" role="status">{{ t('reminders.testFailed') }}</span>
    </div>
  </section>
</template>
