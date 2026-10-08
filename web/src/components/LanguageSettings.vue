<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LANGUAGES, preferredLanguage, setLanguage } from '../i18n'

const { t } = useI18n()
const choice = ref(preferredLanguage())

function change(value: string) {
  choice.value = value
  setLanguage(value)
}
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold">{{ t('settings.language') }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t('settings.languageHint') }}</p>
    <select class="field mt-3 !w-auto" :value="choice" :aria-label="t('settings.language')" @change="change(($event.target as HTMLSelectElement).value)">
      <option value="auto">{{ t('settings.languageAuto') }}</option>
      <option v-for="l in LANGUAGES" :key="l.code" :value="l.code" :lang="l.code">{{ l.name }}</option>
    </select>
  </section>
</template>
