<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api'
import { useErrors } from '../composables'

const { t } = useI18n()
const { error, report } = useErrors()

const form = ref({ idleMinutes: 15, claudeProjectsDir: '', weekStart: 'monday' as 'monday' | 'sunday' })
const saved = ref(false)

onMounted(async () => {
  try {
    const s = await api.settings()
    form.value = { idleMinutes: s.idleMinutes, claudeProjectsDir: s.claudeProjectsDir, weekStart: s.weekStart }
  } catch (e) {
    report(e)
  }
})

async function save() {
  try {
    const s = await api.updateSettings({ ...form.value, idleMinutes: Number(form.value.idleMinutes) })
    form.value = { idleMinutes: s.idleMinutes, claudeProjectsDir: s.claudeProjectsDir, weekStart: s.weekStart }
    error.value = null
    saved.value = true
    setTimeout(() => (saved.value = false), 3000)
    await api.timeSync()
  } catch (e) {
    report(e)
  }
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('time.settings') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('time.settingsHint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>
    <form class="mt-4 space-y-4" @submit.prevent="save">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('time.idle') }}</span>
          <input v-model.number="form.idleMinutes" type="number" min="5" max="120" step="1" class="field" required />
          <span class="mt-1 block text-xs text-muted">{{ t('time.idleHint') }}</span>
        </label>
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('time.weekStart') }}</span>
          <select v-model="form.weekStart" class="field">
            <option value="monday">{{ t('time.monday') }}</option>
            <option value="sunday">{{ t('time.sunday') }}</option>
          </select>
        </label>
      </div>
      <label class="block">
        <span class="mb-1.5 block text-sm font-medium">{{ t('time.transcripts') }}</span>
        <input v-model="form.claudeProjectsDir" class="field font-mono" maxlength="1000" />
      </label>
      <div class="flex items-center gap-3">
        <button class="btn">{{ t('time.saveSettings') }}</button>
        <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
      </div>
    </form>
  </section>
</template>
