<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const tags = defineModel<string[]>({ required: true })
defineProps<{ suggestions?: string[] }>()
const { t } = useI18n()
const draft = ref('')

function add() {
  const value = draft.value.trim().toLowerCase()
  if (value && !tags.value.includes(value)) tags.value = [...tags.value, value]
  draft.value = ''
}
function remove(tag: string) {
  tags.value = tags.value.filter((t) => t !== tag)
}
</script>

<template>
  <div class="field flex flex-wrap items-center gap-1.5 !py-1.5 focus-within:border-action focus-within:ring-3 focus-within:ring-glow">
    <span v-for="tag in tags" :key="tag" class="inline-flex items-center gap-1 rounded-full border border-action/30 bg-action/10 px-2 py-0.5 text-xs text-action">
      {{ tag }}
      <button type="button" class="text-muted hover:text-danger" :aria-label="t('a11y.removeTag', { tag })" @click="remove(tag)">×</button>
    </span>
    <input
      v-model="draft"
      list="tag-suggestions"
      maxlength="50"
      class="min-w-40 flex-1 bg-transparent py-0.5 text-sm outline-none"
      :placeholder="t('detail.addTag')"
      @keydown.enter.prevent="add"
      @keydown="(e: KeyboardEvent) => e.key === ',' && (e.preventDefault(), add())"
      @blur="add"
    />
    <datalist id="tag-suggestions">
      <option v-for="s in suggestions" :key="s" :value="s" />
    </datalist>
  </div>
</template>
