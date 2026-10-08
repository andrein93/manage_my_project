<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Category } from '../api'
import { useErrors } from '../composables'

const { t } = useI18n()
const { error, report } = useErrors()

const categories = ref<Category[]>([])
const name = ref('')
const confirmRemove = ref<string | null>(null)

async function load() {
  categories.value = await api.categories()
}

async function run(action: () => Promise<unknown>) {
  try {
    await action()
    error.value = null
    await load()
  } catch (e) {
    report(e)
  }
}

const add = () =>
  run(async () => {
    await api.createCategory({ name: name.value })
    name.value = ''
  })

function rename(c: Category, value: string) {
  if (value.trim() && value.trim() !== c.name) run(() => api.updateCategory(c.id, { name: value }))
}

function recolor(c: Category, color: string) {
  run(() => api.updateCategory(c.id, { color }))
}

function move(index: number, delta: -1 | 1) {
  const category = categories.value[index]
  if (category) run(() => api.moveCategory(category.id, delta < 0 ? 'up' : 'down'))
}

function remove(c: Category) {
  if (confirmRemove.value !== c.id) {
    confirmRemove.value = c.id
    return
  }
  confirmRemove.value = null
  run(() => api.removeCategory(c.id))
}

onMounted(() => load().catch(report))
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('settings.categories') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('settings.categoriesHint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>

    <ul class="mt-4 divide-y divide-line">
      <li v-for="(c, i) in categories" :key="c.id" class="flex items-center gap-3 py-2">
        <input
          type="color"
          class="h-7 w-7 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0.5"
          :value="c.color"
          :aria-label="t('settings.color', { name: c.name })"
          @change="recolor(c, ($event.target as HTMLInputElement).value)"
        />
        <input
          class="field !py-1.5"
          :value="c.name"
          maxlength="80"
          :aria-label="t('settings.categoryName')"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          @change="rename(c, ($event.target as HTMLInputElement).value)"
        />
        <span class="w-20 shrink-0 text-right text-xs text-muted tabular-nums">{{ t('list.count', { n: c.projectCount }, c.projectCount) }}</span>
        <div class="flex shrink-0">
          <button type="button" class="btn btn-sm" :disabled="i === 0" :aria-label="t('settings.moveUp', { name: c.name })" @click="move(i, -1)">↑</button>
          <button
            type="button"
            class="btn btn-sm"
            :disabled="i === categories.length - 1"
            :aria-label="t('settings.moveDown', { name: c.name })"
            @click="move(i, 1)"
          >
            ↓
          </button>
        </div>
        <button
          type="button"
          class="btn shrink-0 !py-1"
          :class="{ '!border-danger !text-danger': confirmRemove === c.id }"
          @click="remove(c)"
        >
          {{ confirmRemove === c.id ? t('settings.removeConfirm') : t('settings.remove') }}
        </button>
      </li>
    </ul>
    <form class="mt-3 flex gap-2" @submit.prevent="add">
      <input v-model="name" class="field" required maxlength="80" :placeholder="t('settings.categoryName')" :aria-label="t('settings.categoryName')" />
      <button class="btn btn-primary shrink-0">{{ t('settings.addCategory') }}</button>
    </form>
  </section>
</template>
