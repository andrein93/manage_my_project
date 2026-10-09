<script setup lang="ts">
import { FilePlus } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useErrors } from '../composables'
import { localDate } from '../time'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{ clientId: string }>()
const { t, locale } = useI18n()
const router = useRouter()
const { error, report } = useErrors()

const period = ref<'last-month' | 'month' | 'custom'>('last-month')
const from = ref('')
const to = ref('')
const busy = ref(false)

/** First and last day of this or last month, in local time. */
function monthRange(offset: number) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: localDate(first), to: localDate(last) }
}

const range = computed(() =>
  period.value === 'custom' ? { from: from.value, to: to.value } : monthRange(period.value === 'month' ? 0 : -1),
)

async function create() {
  if (!range.value.from || !range.value.to) return
  busy.value = true
  try {
    const s = await api.createStatement({ clientId: props.clientId, ...range.value, language: locale.value })
    router.push({ name: 'statement', params: { id: s.id } })
  } catch (e) {
    report(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
    <select v-model="period" class="field !w-auto" :aria-label="t('statement.period')">
      <option value="last-month">{{ t('time.period.last-month') }}</option>
      <option value="month">{{ t('time.period.month') }}</option>
      <option value="custom">{{ t('time.period.custom') }}</option>
    </select>
    <template v-if="period === 'custom'">
      <input v-model="from" type="date" class="field !w-auto" required :aria-label="t('time.from')" />
      <input v-model="to" type="date" class="field !w-auto" required :aria-label="t('time.to')" />
    </template>
    <UiButton type="submit" variant="primary" :icon="FilePlus" :disabled="busy">{{ t('statement.new') }}</UiButton>
    <p v-if="error" class="w-full text-sm text-danger" role="alert">{{ error }}</p>
  </form>
</template>
