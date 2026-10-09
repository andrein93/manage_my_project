<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, type Billing } from '../api'
import { useErrors } from '../composables'

const { t } = useI18n()
const { error, report, clear } = useErrors()
const form = ref<Billing | null>(null)
const saved = ref(false)
const busy = ref(false)

onMounted(async () => {
  try {
    form.value = { ...(await api.settings()).billing }
  } catch (e) {
    report(e)
  }
})

async function save() {
  if (!form.value) return
  busy.value = true
  clear()
  try {
    form.value = { ...(await api.updateSettings({ billing: form.value })).billing }
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
    <h2 class="text-lg font-semibold">{{ t('settings.billingTitle') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('settings.billingHint') }}</p>
    <p v-if="error" class="mt-2 text-sm text-danger" role="alert">{{ error }}</p>
    <form v-if="form" class="mt-4 grid gap-3 sm:grid-cols-2" @submit.prevent="save">
      <label class="block sm:col-span-2">
        <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingName') }}</span>
        <input v-model="form.name" class="field" maxlength="200" />
      </label>
      <label class="block sm:col-span-2">
        <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingAddress') }}</span>
        <textarea v-model="form.address" class="field min-h-20" maxlength="2000" />
      </label>
      <label class="block">
        <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingTaxId') }}</span>
        <input v-model="form.taxId" class="field" maxlength="100" />
      </label>
      <label class="block">
        <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingIban') }}</span>
        <input v-model="form.iban" class="field font-mono" maxlength="100" />
      </label>
      <label class="block sm:col-span-2">
        <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingFooter') }}</span>
        <textarea v-model="form.footer" class="field min-h-16" maxlength="2000" />
      </label>
      <label class="block">
        <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingPrefix') }}</span>
        <input v-model="form.numberPrefix" class="field font-mono" maxlength="12" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingVat') }}</span>
          <input v-model.number="form.vatRate" type="number" min="0" max="100" step="0.1" class="field" />
        </label>
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium">{{ t('settings.billingDue') }}</span>
          <input v-model.number="form.dueDays" type="number" min="0" max="365" step="1" class="field" />
        </label>
      </div>
      <div class="flex items-center gap-3 sm:col-span-2">
        <button class="btn btn-primary" :disabled="busy">{{ t('settings.billingSave') }}</button>
        <span v-if="saved" class="text-sm text-fresh" role="status">{{ t('detail.saved') }}</span>
      </div>
    </form>
  </section>
</template>
