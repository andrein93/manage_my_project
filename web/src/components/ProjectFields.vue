<script setup lang="ts">
import { ExternalLink } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type FieldValue } from '../api'
import { useErrors } from '../composables'

const props = defineProps<{ projectId: string }>()
const { t } = useI18n()
const { error, report, clear } = useErrors()
const values = ref<FieldValue[]>([])
const draft = ref<Record<string, string>>({})
const saved = ref(false)
const busy = ref(false)

async function load() {
  try {
    values.value = await api.projectFields(props.projectId)
    draft.value = Object.fromEntries(values.value.map((v) => [v.fieldId, v.value]))
  } catch (e) {
    report(e)
  }
}
watch(() => props.projectId, load, { immediate: true })

const dirty = computed(() => values.value.some((v) => (draft.value[v.fieldId] ?? '') !== v.value))
const inputType = (kind: FieldValue['kind']) => ({ text: 'text', url: 'url', date: 'date', number: 'text' })[kind]

async function save() {
  busy.value = true
  clear()
  try {
    const changed = Object.fromEntries(values.value.filter((v) => (draft.value[v.fieldId] ?? '') !== v.value).map((v) => [v.fieldId, draft.value[v.fieldId] || null]))
    values.value = await api.setProjectFields(props.projectId, changed)
    draft.value = Object.fromEntries(values.value.map((v) => [v.fieldId, v.value]))
    saved.value = true
    setTimeout(() => (saved.value = false), 2500)
  } catch (e) {
    report(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <div class="mb-3 flex items-baseline justify-between gap-3">
      <h2 class="text-lg font-semibold">{{ t('fields.projectTitle') }}</h2>
      <RouterLink to="/settings" class="text-sm text-muted hover:text-ink">{{ t('fields.manage') }}</RouterLink>
    </div>
    <p v-if="error" class="mb-3 text-sm text-danger" role="alert">{{ error }}</p>
    <p v-if="!values.length" class="text-sm text-muted">{{ t('fields.none') }}</p>
    <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
      <label v-for="v in values" :key="v.fieldId" class="block">
        <span class="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
          {{ v.name }}
          <a v-if="v.kind === 'url' && v.value" :href="v.value" target="_blank" rel="noopener noreferrer" class="text-muted hover:text-action" :aria-label="v.value">
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
        </span>
        <input
          v-model="draft[v.fieldId]"
          :type="inputType(v.kind)"
          :inputmode="v.kind === 'number' ? 'decimal' : undefined"
          class="field"
          maxlength="2000"
          :placeholder="v.kind === 'url' ? 'https://' : ''"
        />
      </label>
      <div class="flex items-center gap-3 sm:col-span-2">
        <button class="btn btn-primary" :disabled="!dirty || busy">{{ t('detail.save') }}</button>
        <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
      </div>
    </form>
  </section>
</template>
