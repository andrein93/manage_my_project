<script setup lang="ts">
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, FIELD_KINDS, type FieldKind, type ProjectField } from '../api'
import { useErrors } from '../composables'
import UiBadge from '../ui/UiBadge.vue'

const { t } = useI18n()
const { error, report, clear } = useErrors()
const fields = ref<ProjectField[]>([])
const name = ref('')
const kind = ref<FieldKind>('text')
const confirm = ref<string | null>(null)

async function load() {
  try {
    fields.value = await api.fields()
  } catch (e) {
    report(e)
  }
}
onMounted(load)

async function run(fn: () => Promise<unknown>) {
  clear()
  try {
    await fn()
    await load()
  } catch (e) {
    report(e)
  }
}

const add = () =>
  run(async () => {
    await api.createField({ name: name.value, kind: kind.value })
    name.value = ''
  })
const rename = (f: ProjectField, value: string) => value.trim() && value !== f.name && run(() => api.updateField(f.id, { name: value }))
const setRemind = (f: ProjectField, value: string) =>
  run(() => api.updateField(f.id, { remindDays: value === '' ? null : Number(value) }))
const move = (f: ProjectField, direction: 'up' | 'down') => run(() => api.moveField(f.id, direction))
function remove(f: ProjectField) {
  if (confirm.value !== f.id) {
    confirm.value = f.id
    return
  }
  confirm.value = null
  run(() => api.removeField(f.id))
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('fields.title') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('fields.hint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>

    <ul v-if="fields.length" class="mt-4 divide-y divide-line">
      <li v-for="(f, i) in fields" :key="f.id" class="flex flex-wrap items-center gap-2 py-2">
        <input
          :value="f.name"
          class="field max-w-64 flex-1"
          maxlength="60"
          :aria-label="t('fields.name')"
          @change="rename(f, ($event.target as HTMLInputElement).value)"
        />
        <UiBadge>{{ t(`fields.kinds.${f.kind}`) }}</UiBadge>
        <label v-if="f.kind === 'date'" class="flex items-center gap-2 text-sm text-muted">
          {{ t('fields.remind') }}
          <input
            :value="f.remindDays ?? ''"
            type="number"
            min="0"
            max="365"
            class="field !w-20"
            :placeholder="t('fields.never')"
            @change="setRemind(f, ($event.target as HTMLInputElement).value)"
          />
          {{ t('fields.daysBefore') }}
        </label>
        <span class="ml-auto flex items-center gap-1">
          <button type="button" class="btn btn-sm" :disabled="i === 0" :aria-label="t('settings.moveUp', { name: f.name })" @click="move(f, 'up')">
            <ArrowUp class="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :disabled="i === fields.length - 1"
            :aria-label="t('settings.moveDown', { name: f.name })"
            @click="move(f, 'down')"
          >
            <ArrowDown class="size-3.5" aria-hidden="true" />
          </button>
          <button type="button" class="btn btn-sm btn-danger" @click="remove(f)">
            <Trash2 class="size-3.5" aria-hidden="true" />{{ confirm === f.id ? t('fields.removeConfirm') : t('settings.remove') }}
          </button>
        </span>
      </li>
    </ul>

    <form class="mt-3 flex flex-wrap gap-2" @submit.prevent="add">
      <input v-model="name" class="field max-w-64 flex-1" required maxlength="60" :placeholder="t('fields.namePlaceholder')" :aria-label="t('fields.name')" />
      <select v-model="kind" class="field !w-auto" :aria-label="t('fields.kind')">
        <option v-for="k in FIELD_KINDS" :key="k" :value="k">{{ t(`fields.kinds.${k}`) }}</option>
      </select>
      <button class="btn btn-primary">{{ t('fields.add') }}</button>
    </form>
  </section>
</template>
